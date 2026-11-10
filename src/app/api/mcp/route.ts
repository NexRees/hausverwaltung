import { authenticateBearer, type ApiPrincipal } from "@/lib/api-auth";
import * as data from "@/lib/api-data";
// nexrees: paging, single-record reads, search, argument validation, annotations, structuredContent
import { PersonType, TicketStatus } from "@prisma/client";
import { readRecord, READ_ENTITIES } from "@/lib/api-read";
import { searchEntities, SEARCH_ENTITIES, type SearchEntity } from "@/lib/search";
import {
  negotiateProtocol, validateArgs, formatProblems, toolAnnotations, toolResult, mcpPage,
  MCP_DEFAULT_LIMIT, MCP_MAX_LIMIT, type JsonSchema,
} from "@/lib/mcp-protocol";
import { APP_VERSION_FULL_NUMBER, APP_SHA } from "@/lib/version";
import { apiCreate, apiUpdate, apiDelete, listEntities, ENTITIES } from "@/lib/api-write";
import { runOperation, listOperations, OPERATION_NAMES } from "@/lib/api-ops";
import { BRAND } from "@/lib/brand";

// MCP-Server (Model Context Protocol) über Streamable HTTP / JSON-RPC.
// Auth: Bearer-Token (persönlicher API-Token). Der Agent (Claude, ChatGPT,
// beliebiger MCP-Client) kann damit den Bestand lesen, verstehen und bearbeiten.
// Stateless: jede POST-Anfrage ist eigenständig, Antwort als application/json.

// nexrees: protocol version is negotiated (negotiateProtocol); guidance for agents on initialize
const INSTRUCTIONS = [
  `${BRAND.name} Hausverwaltung.`,
  "DE: Datensätze zuerst mit `search` finden (Name, Adresse, Einheit; jedes Wort muss passen), Details mit `get_record` (entity + id).",
  "Listen sind seitenweise: `limit` (max. 200, Standard 50) und `offset`; die Antwort enthält `total` und `nextOffset` (null = letzte Seite).",
  "IDs sind stabil und dürfen gespeichert werden. Vor `create_record`/`update_record` `list_entities` aufrufen.",
  "Jeder Schreibzugriff läuft als Benutzer des Tokens und wird protokolliert; `delete_record` und `run_operation` sind nicht umkehrbar.",
  "Beträge in EUR, Datumsangaben ISO 8601 (YYYY-MM-DD).",
  "EN: Use `search` first (every word must match), then `get_record` for details. Lists are paged with `limit` (max 200, default 50)",
  "and `offset`; results carry `total` and `nextOffset` (null on the last page). Ids are stable. Call `list_entities` before writing.",
  "Writes run as the token's user and are audited; deletes and operations cannot be undone. Amounts in EUR, dates ISO 8601.",
].join("\n");
const SERVER_VERSION = APP_SHA ? `${APP_VERSION_FULL_NUMBER}+${APP_SHA}` : APP_VERSION_FULL_NUMBER;

type Tool = {
  name: string;
  description: string;
  inputSchema: JsonSchema;
  run: (p: ApiPrincipal, args: Record<string, unknown>) => Promise<unknown>;
};

const obj = (props: Record<string, JsonSchema>, required: string[] = []): JsonSchema => ({
  type: "object",
  properties: props,
  required,
  additionalProperties: false, // nexrees: a misspelt argument is reported instead of silently ignored
});
const str = { type: "string" };
const rec = { type: "object", additionalProperties: true };
const entityEnum = { type: "string", enum: ENTITIES };
const bool = { type: "boolean" };
const idOf = (what: string) => ({ type: "string", description: `ID ${what}` });

// nexrees: every list tool is paged and answers { items, total, offset, limit, nextOffset }
const PAGING: Record<string, JsonSchema> = {
  limit: { type: "integer", minimum: 1, maximum: MCP_MAX_LIMIT, default: MCP_DEFAULT_LIMIT, description: `Einträge pro Seite / page size (1–${MCP_MAX_LIMIT}, Standard ${MCP_DEFAULT_LIMIT})` },
  offset: { type: "integer", minimum: 0, default: 0, description: "Zu überspringende Einträge / rows to skip (nextOffset der vorigen Seite)" },
};
const Q: Record<string, JsonSchema> = {
  q: { type: "string", description: "Freitext, jedes Wort muss passen / free text, every word must match" },
};

function listTool<O>(
  name: string,
  description: string,
  fn: (tenantId: string, o: O) => Promise<{ items: unknown[]; total: number }>,
  filters: Record<string, JsonSchema> = {},
): Tool {
  return {
    name,
    description: `${description} Seitenweise (limit/offset).`,
    inputSchema: obj({ ...filters, ...PAGING }),
    run: async (p, a) => {
      const limit = typeof a.limit === "number" ? a.limit : MCP_DEFAULT_LIMIT;
      const offset = typeof a.offset === "number" ? a.offset : 0;
      // arguments are validated against inputSchema before run
      return mcpPage(await fn(p.tenantId, { ...a, limit, offset } as unknown as O), offset, limit);
    },
  };
}

const notFound = (what: string, id: string) => new Error(`Nicht gefunden (not found): ${what} ${id}`);

const CHARGE_STATUS = { type: "string", enum: data.CHARGE_FILTER_STATUSES, description: "UNPAID = alles mit offenem Betrag / everything with money open" };

const TOOLS: Tool[] = [
  {
    name: "search",
    description:
      "Suche über Objekte, Einheiten, Personen, Verträge, Tickets, Versammlungen, Handwerker und Dokumente. Jedes Wort muss passen (\"Erika Mustermann\"). Treffer mit entity, id, label, href und apiHref; counts = echte Trefferzahl je Typ. Zuerst nutzen, um IDs zu finden.",
    inputSchema: obj(
      {
        q: { type: "string", description: "Suchbegriff / query" },
        limit: { type: "integer", minimum: 1, maximum: 50, default: 10, description: "Treffer je Typ / hits per entity" },
        entities: { type: "array", items: { type: "string", enum: SEARCH_ENTITIES }, description: "Nur diese Typen / only these entities" },
      },
      ["q"],
    ),
    run: async (p, a) => {
      const entities = Array.isArray(a.entities) ? a.entities.map(String) : undefined;
      const unknown = entities?.filter((e) => !(SEARCH_ENTITIES as readonly string[]).includes(e)) ?? [];
      if (unknown.length) throw new Error(`entities: unbekannt ${unknown.join(", ")} (erlaubt: ${SEARCH_ENTITIES.join(", ")})`);
      const r = await searchEntities(p.tenantId, String(a.q), {
        limit: typeof a.limit === "number" ? a.limit : 10,
        entities: entities as SearchEntity[] | undefined,
      });
      return { q: r.q, total: r.total, counts: Object.fromEntries(r.groups.map((g) => [g.entity, g.total])), hits: r.hits };
    },
  },
  {
    name: "get_record",
    description: `Einen Datensatz mit Details und IDs verknüpfter Datensätze lesen. entity: ${READ_ENTITIES.join(", ")}.`,
    inputSchema: obj({ entity: { type: "string", enum: READ_ENTITIES }, id: str }, ["entity", "id"]),
    run: async (p, a) => {
      const row = await readRecord(p.tenantId, String(a.entity), String(a.id));
      if (!row) throw notFound(String(a.entity), String(a.id));
      return row;
    },
  },
  {
    name: "portfolio_summary",
    description: "Kennzahlen-Überblick: Objekte, Einheiten, Vermietung, Sollmiete/Monat, offene Posten, offene Tickets.",
    inputSchema: obj({}),
    run: (p) => data.portfolioSummary(p.tenantId),
  },
  listTool("list_properties", "Objekte (Liegenschaften) mit Adresse, Verwaltungsart, Einheitenzahl und buildingIds.", data.listProperties, Q),
  {
    name: "get_property",
    description: "Ein Objekt mit Gebäuden und Einheiten (Details).",
    inputSchema: obj({ id: str }, ["id"]),
    run: async (p, a) => (await data.getProperty(p.tenantId, String(a.id))) ?? Promise.reject(notFound("property", String(a.id))),
  },
  listTool("list_units", "Einheiten (Wohnungen/Gewerbe/Stellplätze) mit Objekt, Fläche, Zimmern, propertyId und buildingId.", data.listUnits, {
    ...Q,
    propertyId: idOf("Objekt"),
  }),
  listTool("list_persons", "Personen/Kontakte (Mieter, Eigentümer, Interessenten, Handwerker …).", data.listPersons, {
    ...Q,
    type: { type: "string", enum: Object.values(PersonType) },
  }),
  listTool("list_leases", "Mietverträge mit Objekt, Einheit, Mietern (renters: id + Name), Kaltmiete und Laufzeit.", data.listLeases, {
    ...Q,
    unitId: idOf("Einheit"),
    propertyId: idOf("Objekt"),
    personId: idOf("Mieter (Person)"),
    active: { ...bool, description: "true = heute laufende Verträge / active today" },
  }),
  listTool("list_tickets", "Instandhaltungs-/Schadens-Tickets mit Status, Priorität, Objekt, Einheit und Zuständigkeit.", data.listTickets, {
    ...Q,
    status: { type: "string", enum: Object.values(TicketStatus) },
    propertyId: idOf("Objekt"),
    unitId: idOf("Einheit"),
  }),
  listTool("list_open_items", "Offene Posten (unbezahlte Sollstellungen) mit Betrag, offen, Fälligkeit, Überfälligkeit, leaseId, unitId.", data.listOpenItems, {
    leaseId: idOf("Mietvertrag"),
    overdue: { ...bool, description: "true = nur überfällige / overdue only" },
  }),
  listTool("list_owners", "Eigentümer-Zuordnungen (Person je Einheit mit Anteil in Tausendstel).", data.listOwners, {
    unitId: idOf("Einheit"),
    personId: idOf("Person"),
  }),
  listTool("list_meters", "Zähler (Strom/Wasser/Wärme …) mit Einheit, Objekt und letztem Zählerstand.", data.listMeters, { unitId: idOf("Einheit") }),
  listTool("list_accounts", "Konten (Bank/Kaution/Rücklage) mit Saldo.", data.listAccounts),
  listTool("list_charges", "Sollstellungen (Forderungen) mit Betrag, gezahlt, offen, Status, Fälligkeit, leaseId und unitId. Neueste zuerst.", data.listCharges, {
    leaseId: idOf("Mietvertrag"),
    status: CHARGE_STATUS,
  }),
  listTool("list_payments", "Zahlungen (Ein-/Ausgänge) mit Betrag, Datum, Konto, Sollstellung und Verwendungszweck.", data.listPayments, {
    accountId: idOf("Konto"),
    chargeId: idOf("Sollstellung"),
  }),
  listTool("list_documents", "Dokumente (Verträge, Rechnungen, Protokolle, Abrechnungen) mit Kategorie, Zuordnung und E-Rechnungs-Daten.", data.listDocuments, {
    ...Q,
    propertyId: idOf("Objekt"),
    unitId: idOf("Einheit"),
    personId: idOf("Person"),
  }),
  listTool("list_meetings", "Eigentümerversammlungen mit Datum, Status, Ort, Anzahl TOPs und Beschlüsse.", data.listMeetings),
  listTool("list_resolutions", "Beschlusssammlung (§24 WEG): Beschlüsse je Objekt mit Nummer, Text, Ergebnis und Abstimmung.", data.listResolutions),
  listTool("list_economic_plans", "WEG-Wirtschaftspläne (§28) je Objekt/Jahr mit Gesamtbetrag und monatlichem Hausgeld.", data.listEconomicPlans),
  listTool("list_reserves", "Erhaltungsrücklagen je Objekt mit aktuellem Saldo.", data.listReserves),
  listTool("list_appointments", "Termine (Besichtigung/Versammlung/Wartung/Frist) mit Start, Ende, Ort und Teilnehmern.", data.listAppointments),
  listTool("list_tasks", "Aufgaben/Wiedervorlagen mit Fälligkeit, Status, Zuständigkeit und verknüpftem Datensatz.", data.listTasks, {
    done: { ...bool, description: "false = nur offene / open only" },
  }),
  listTool("list_contractors", "Handwerker/Dienstleister mit Gewerk und Kontakt.", data.listContractors, Q),
  listTool("list_maintenance_contracts", "Wartungsverträge mit Intervall, nächster Fälligkeit und Dienstleister.", data.listMaintenanceContracts),
  listTool("list_insurances", "Versicherungen je Objekt mit Typ, Versicherer, Police und Jahresprämie.", data.listInsurances),
  listTool("list_property_taxes", "Grundsteuer je Objekt (Aktenzeichen, Messbetrag, Hebesatz, berechneter Jahresbetrag).", data.listPropertyTaxes),
  {
    name: "create_task",
    description: "Neue Aufgabe/Wiedervorlage anlegen. dueDate optional als YYYY-MM-DD.",
    inputSchema: obj({ title: str, dueDate: str }, ["title"]),
    run: (p, a) => data.createTask(p.tenantId, { title: String(a.title), dueDate: a.dueDate ? String(a.dueDate) : undefined }),
  },
  {
    name: "list_entities",
    description:
      "Schema-Discovery: alle schreibbaren Entitäten mit ihren Feldern und Relationen. IMMER zuerst aufrufen, bevor create_record/update_record genutzt wird, um die korrekten Feldnamen zu kennen.",
    inputSchema: obj({}),
    run: async () => listEntities(),
  },
  {
    name: "create_record",
    description:
      "Beliebigen Datensatz anlegen (Objekt, Einheit, Person, Vertrag, Buchung, Versammlung, Beschluss, WEG-Plan, Versicherung, Benutzer …). entity = Typ aus list_entities, data = Felder. Relation-IDs (z. B. propertyId) müssen zum Mandanten gehören.",
    inputSchema: obj({ entity: entityEnum, data: rec }, ["entity", "data"]),
    run: (p, a) => apiCreate(p, String(a.entity), (a.data as Record<string, unknown>) ?? {}),
  },
  {
    name: "update_record",
    description: "Datensatz ändern. entity + id + data (nur zu ändernde Felder). Nur bei aktualisierbaren Entitäten (siehe list_entities.writable). Dokumente (entity document): name, category, propertyId, unitId, personId; null oder \"\" löst eine Zuordnung.",
    inputSchema: obj({ entity: entityEnum, id: str, data: rec }, ["entity", "id", "data"]),
    run: (p, a) => apiUpdate(p, String(a.entity), String(a.id), (a.data as Record<string, unknown>) ?? {}),
  },
  {
    name: "delete_record",
    description:
      "Datensatz löschen. entity + id. Mandanten-gescopt. Bei entity document wird auch die Datei gelöscht (endgültig). " +
      "Achtung: Löschen kaskadiert — ein Objekt (property) löscht seine Gebäude, Einheiten, Verträge, Sollstellungen, Zähler, " +
      "Versammlungen und Beschlüsse mit; ein Gebäude seine Einheiten; eine Einheit ihre Verträge, Zähler und Eigentümer; " +
      "ein Mietvertrag seine Sollstellungen und Mietbestandteile. Deleting a property/building/unit/lease cascades to dependent records.",
    inputSchema: obj({ entity: entityEnum, id: str }, ["entity", "id"]),
    run: (p, a) => apiDelete(p, String(a.entity), String(a.id)),
  },
  {
    name: "list_operations",
    description:
      "Verfügbare Operationen (kein reines CRUD): Sollstellungslauf, Mahnlauf, Mietanpassung anwenden, Wartung fortschreiben, Zeiterfassung, Bank-Import, E-Mail senden, Dokument-Upload, Konfiguration. Zuerst aufrufen, um Namen + Parameter zu kennen.",
    inputSchema: obj({}),
    run: async () => listOperations(),
  },
  {
    name: "run_operation",
    description:
      "Operation ausführen. operation = Name aus list_operations, args = Parameter. Beispiele: run_charge_generation{month:'2026-02'}, run_dunning{}, apply_adjustment{id}, send_email{toAddress,subject,body}, import_camt{xml}.",
    inputSchema: obj({ operation: { type: "string", enum: OPERATION_NAMES }, args: rec }, ["operation"]),
    run: (p, a) => runOperation(p, String(a.operation), (a.args as Record<string, unknown>) ?? {}),
  },
  {
    name: "create_ticket",
    description: "Neues Ticket/Schadensmeldung anlegen. propertyId optional.",
    inputSchema: obj(
      { title: str, description: str, propertyId: str, priority: { type: "string", enum: ["NIEDRIG", "MITTEL", "HOCH"] } },
      ["title"],
    ),
    run: (p, a) =>
      data.createTicket(p.tenantId, {
        title: String(a.title),
        description: a.description ? String(a.description) : undefined,
        propertyId: a.propertyId ? String(a.propertyId) : undefined,
        priority: a.priority ? String(a.priority) : undefined,
      }),
  },
  {
    name: "create_person",
    description: "Neue Person/Kontakt anlegen (z. B. Interessent).",
    inputSchema: obj(
      { firstName: str, lastName: str, email: str, phone: str, type: str },
      ["firstName", "lastName"],
    ),
    run: (p, a) =>
      data.createPerson(p.tenantId, {
        firstName: String(a.firstName),
        lastName: String(a.lastName),
        email: a.email ? String(a.email) : undefined,
        phone: a.phone ? String(a.phone) : undefined,
        type: a.type ? String(a.type) : undefined,
      }),
  },
];

const rpc = (id: unknown, result: unknown) => Response.json({ jsonrpc: "2.0", id, result });
const rpcError = (id: unknown, code: number, message: string) =>
  Response.json({ jsonrpc: "2.0", id, error: { code, message } });

export async function POST(req: Request) {
  const principal = await authenticateBearer(req);
  if (!principal) {
    return Response.json(
      { jsonrpc: "2.0", id: null, error: { code: -32001, message: "Unauthorized" } },
      { status: 401, headers: { "WWW-Authenticate": "Bearer" } },
    );
  }

  const body = await req.json().catch(() => undefined);
  if (body === undefined) return rpcError(null, -32700, "Parse error"); // nexrees: JSON-RPC parse error code
  if (!body || body.jsonrpc !== "2.0") return rpcError(null, -32600, "Invalid Request");
  const { id, method, params } = body;

  // Notifications (keine Antwort erwartet)
  if (typeof method === "string" && method.startsWith("notifications/")) {
    return new Response(null, { status: 202 });
  }

  switch (method) {
    case "initialize":
      return rpc(id, {
        protocolVersion: negotiateProtocol(params?.protocolVersion),
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: BRAND.name, version: SERVER_VERSION },
        instructions: INSTRUCTIONS,
      });
    case "ping":
      return rpc(id, {});
    case "tools/list":
      return rpc(id, {
        tools: TOOLS.map((t) => ({
          name: t.name,
          description: t.description,
          inputSchema: t.inputSchema,
          annotations: toolAnnotations(t.name),
        })),
      });
    case "tools/call": {
      const tool = TOOLS.find((t) => t.name === params?.name);
      if (!tool) return rpcError(id, -32602, `Unbekanntes Tool: ${params?.name}`);
      // nexrees: check arguments against inputSchema first (no "undefined" ids reaching the database)
      const problems = validateArgs(tool.inputSchema, params?.arguments);
      if (problems.length) {
        return rpc(id, {
          content: [{ type: "text", text: formatProblems(problems) }],
          structuredContent: { error: formatProblems(problems), code: "invalid_arguments", problems },
          isError: true,
        });
      }
      try {
        const result = await tool.run(principal, params?.arguments ?? {});
        return rpc(id, toolResult(result));
      } catch (e) {
        return rpc(id, {
          content: [{ type: "text", text: `Fehler: ${e instanceof Error ? e.message : "unbekannt"}` }],
          isError: true,
        });
      }
    }
    default:
      return rpcError(id, -32601, `Methode nicht unterstützt: ${method}`);
  }
}

// Manche Clients prüfen GET (SSE-Stream). Stateless → nicht unterstützt.
export function GET() {
  return new Response("MCP: bitte POST (JSON-RPC) verwenden.", { status: 405 });
}
