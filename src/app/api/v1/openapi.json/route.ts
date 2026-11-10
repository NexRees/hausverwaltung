// OpenAPI 3.1 Beschreibung der HaVeWa REST-API. Öffentlich (keine Geheimnisse),
// dient Scalar/Swagger als Referenz.
import { BRAND } from "@/lib/brand";

// nexrees: lists are paged (limit/offset, optional q and filters) with X-Total-Count + Link headers;
// errors share one schema { error, code }; single-record reads and search are documented.
const ref = (kind: string, name: string) => ({ $ref: `#/components/${kind}/${name}` });
const R = (name: string) => ref("responses", name);
const qp = (name: string, description: string, schema: object = { type: "string" }) => ({ name, in: "query", required: false, description, schema });
const idFilter = (name: string, what: string) => qp(name, `Nur Einträge zu dieser ${what}-ID`);
const pathParam = (name: string) => ({ name, in: "path", required: true, schema: { type: "string" } });

const listOp = (tag: string, summary: string, opts: { q?: boolean; filters?: object[] } = {}) => ({
  tags: [tag],
  summary,
  description:
    "Ohne Paging-Parameter: das ganze Array, höchstens 5.000 Zeilen (dann X-Result-Truncated: true und Link rel=next). " +
    "Mit limit, offset oder q: eine Seite (Standard 100, max. 500). Der Body ist immer ein JSON-Array.",
  security: [{ bearerAuth: [] }],
  parameters: [ref("parameters", "limit"), ref("parameters", "offset"), ...(opts.q ? [ref("parameters", "q")] : []), ...(opts.filters ?? [])],
  responses: {
    "200": {
      description: "OK (eine Seite als JSON-Array)",
      headers: {
        "X-Total-Count": ref("headers", "XTotalCount"),
        Link: ref("headers", "Link"),
        "X-Result-Truncated": ref("headers", "XResultTruncated"),
      },
      content: { "application/json": { schema: { type: "array", items: { type: "object" } } } },
    },
    "400": R("BadRequest"),
    "401": R("Unauthorized"),
    "500": R("InternalError"),
  },
});

// Writes: 409 = closed booking period (Festschreibung), 422 = domain rule (e.g. deposit limit).
const writeErrors = {
  "400": R("BadRequest"),
  "401": R("Unauthorized"),
  "403": R("Forbidden"),
  "404": R("NotFound"),
  "409": R("Conflict"),
  "422": R("Unprocessable"),
  "500": R("InternalError"),
};
const errorResponse = (description: string) => ({
  description,
  content: { "application/json": { schema: ref("schemas", "Error") } },
});

const spec = {
  openapi: "3.1.0",
  info: {
    title: `${BRAND.name} API`,
    version: "1.0.0",
    description:
      `REST-API der Hausverwaltungssoftware ${BRAND.name} (basiert auf HaVeWa, AGPL-3.0). ` +
        "Authentifizierung per Bearer-Token " +
      "(persönlicher Zugangstoken aus den Einstellungen). Alle Daten sind auf den Mandanten des Tokens beschränkt. " +
      "Listen sind seitenweise abrufbar (limit/offset, Gesamtzahl in X-Total-Count, nächste Seite im Link-Header). " +
      "Einzelne Datensätze: GET /api/v1/records/{entity}/{id}; Suche: GET /api/v1/search. " +
      "Fehler antworten immer als JSON { error, code } (error = lesbare Meldung, code = stabiler Bezeichner).",
  },
  servers: [{ url: "/" }],
  components: {
    securitySchemes: {
      bearerAuth: { type: "http", scheme: "bearer", description: "Persönlicher API-Token (Einstellungen → API- & MCP-Zugänge)" },
    },
    schemas: {
      Error: {
        type: "object",
        required: ["error", "code"],
        properties: {
          error: { type: "string", description: "Lesbare Meldung (deutsch)" },
          code: {
            type: "string",
            description:
              "Stabiler Bezeichner, z. B. unauthorized, forbidden, not_found, unknown_entity, invalid_json, invalid_parameter, " +
              "unsupported_parameter, validation_error, bad_request, conflict, unprocessable, internal_error",
          },
        },
        additionalProperties: true,
      },
      SearchHit: {
        type: "object",
        properties: {
          entity: { type: "string", enum: ["property", "unit", "person", "lease", "ticket", "meeting", "contractor", "document"] },
          id: { type: "string" },
          label: { type: "string" },
          sublabel: { type: "string" },
          href: { type: "string", description: "Pfad in der App, z. B. /units/{id}" },
          apiHref: { type: "string", description: "/api/v1/records/{entity}/{id}" },
          status: { type: "string", description: "Status-Code bei Tickets und Versammlungen" },
        },
      },
    },
    parameters: {
      limit: { name: "limit", in: "query", required: false, description: "Seitengröße (Standard 100, max. 500)", schema: { type: "integer", minimum: 1, maximum: 500 } },
      offset: { name: "offset", in: "query", required: false, description: "Zu überspringende Zeilen", schema: { type: "integer", minimum: 0 } },
      q: { name: "q", in: "query", required: false, description: "Freitext; jedes Wort muss in einem der Felder vorkommen (Groß-/Kleinschreibung egal)", schema: { type: "string", maxLength: 100 } },
    },
    headers: {
      XTotalCount: { description: "Anzahl aller Treffer (über alle Seiten)", schema: { type: "integer" } },
      Link: { description: 'Nächste Seite, z. B. </api/v1/charges?limit=100&offset=100>; rel="next" (fehlt auf der letzten Seite)', schema: { type: "string" } },
      XResultTruncated: { description: "true, wenn eine Antwort ohne Paging-Parameter bei 5.000 Zeilen abgeschnitten wurde", schema: { type: "string" } },
    },
    responses: {
      BadRequest: errorResponse("Ungültige Anfrage (invalid_json, invalid_parameter, validation_error …)"),
      Unauthorized: errorResponse("Bearer-Token fehlt oder ungültig (unauthorized)"),
      Forbidden: errorResponse("Keine Berechtigung (forbidden)"),
      NotFound: errorResponse("Nicht gefunden (not_found, unknown_entity)"),
      Conflict: errorResponse("Konflikt, z. B. festgeschriebener Buchungszeitraum (conflict)"),
      Unprocessable: errorResponse("Fachliche Regel verletzt (unprocessable)"),
      InternalError: errorResponse("Interner Fehler (internal_error), ohne Details"),
    },
  },
  security: [{ bearerAuth: [] }],
  paths: {
    "/api/v1/me": {
      get: { tags: ["Allgemein"], summary: "Eigene Info + Portfolio-Kennzahlen", security: [{ bearerAuth: [] }], responses: { "200": { description: "OK" }, "401": { description: "Unauthorized" } } },
    },
    "/api/v1/properties": { get: listOp("Objekte", "Objekte auflisten", { q: true }) },
    "/api/v1/properties/{id}": {
      get: {
        tags: ["Objekte"],
        summary: "Objekt mit Gebäuden & Einheiten",
        security: [{ bearerAuth: [] }],
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
        responses: { "200": { description: "OK" }, "401": R("Unauthorized"), "404": R("NotFound") },
      },
    },
    "/api/v1/units": { get: listOp("Einheiten", "Einheiten auflisten", { q: true, filters: [idFilter("propertyId", "Objekt")] }) },
    "/api/v1/meters": { get: listOp("Einheiten", "Zähler + letzter Stand auflisten", { filters: [idFilter("unitId", "Einheit")] }) },
    "/api/v1/owners": {
      get: listOp("Einheiten", "Eigentümer-Zuordnungen auflisten", { filters: [idFilter("unitId", "Einheit"), idFilter("personId", "Person")] }),
    },
    "/api/v1/leases": {
      get: listOp("Verträge", "Mietverträge auflisten (renters mit id + Name, unitId, propertyId)", {
        q: true,
        filters: [
          idFilter("unitId", "Einheit"),
          idFilter("propertyId", "Objekt"),
          idFilter("personId", "Mieter-Person"),
          qp("active", "true = heute laufend, false = beendet oder künftig", { type: "boolean" }),
        ],
      }),
    },
    "/api/v1/open-items": {
      get: listOp("Finanzen", "Offene Posten auflisten", {
        filters: [idFilter("leaseId", "Mietvertrag"), qp("overdue", "true = nur überfällige", { type: "boolean" })],
      }),
    },
    "/api/v1/accounts": { get: listOp("Finanzen", "Konten + Saldo auflisten") },
    "/api/v1/charges": {
      get: listOp("Finanzen", "Sollstellungen auflisten (gezahlt, offen, Status)", {
        filters: [
          idFilter("leaseId", "Mietvertrag"),
          qp("status", "OPEN, PARTIAL, PAID, OVERDUE oder UNPAID (alles mit offenem Betrag)", {
            type: "string",
            enum: ["OPEN", "PARTIAL", "PAID", "OVERDUE", "UNPAID"],
          }),
        ],
      }),
    },
    "/api/v1/payments": {
      get: listOp("Finanzen", "Zahlungen auflisten", { filters: [idFilter("accountId", "Konto"), idFilter("chargeId", "Sollstellung")] }),
    },
    "/api/v1/documents": {
      get: listOp("Dokumente", "Dokumente auflisten (Metadaten)", {
        q: true,
        filters: [idFilter("propertyId", "Objekt"), idFilter("unitId", "Einheit"), idFilter("personId", "Person")],
      }),
    },
    "/api/v1/meetings": { get: listOp("Versammlung", "Eigentümerversammlungen auflisten") },
    "/api/v1/resolutions": { get: listOp("Versammlung", "Beschlusssammlung auflisten") },
    "/api/v1/economic-plans": { get: listOp("WEG", "Wirtschaftspläne auflisten") },
    "/api/v1/reserves": { get: listOp("WEG", "Erhaltungsrücklagen + Saldo auflisten") },
    "/api/v1/appointments": { get: listOp("Kalender", "Termine auflisten") },
    "/api/v1/contractors": { get: listOp("Instandhaltung", "Handwerker/Dienstleister auflisten", { q: true }) },
    "/api/v1/maintenance-contracts": { get: listOp("Instandhaltung", "Wartungsverträge auflisten") },
    "/api/v1/insurances": { get: listOp("Weitere", "Versicherungen auflisten") },
    "/api/v1/property-taxes": { get: listOp("Weitere", "Grundsteuer auflisten") },
    "/api/v1/operations": {
      get: {
        tags: ["Operationen"],
        summary: "Verfügbare Operationen (kein reines CRUD)",
        description:
          "Sollstellungslauf, Mahnlauf, Mietanpassung anwenden, Wartung fortschreiben, Zeiterfassung, " +
          "Bank-Import (camt.053), E-Mail senden, Dokument-Upload, KI-/SMTP-Konfiguration. " +
          "Ausführen: POST /api/v1/operations/{name} mit den Parametern im Body.",
        security: [{ bearerAuth: [] }],
        responses: { "200": { description: "OK" }, "401": { description: "Unauthorized" } },
      },
    },
    "/api/v1/operations/{name}": {
      post: {
        tags: ["Operationen"],
        summary: "Operation ausführen",
        description: "name z. B. run_charge_generation, run_dunning, apply_adjustment, send_email, import_camt, upload_document …",
        security: [{ bearerAuth: [] }],
        parameters: [{ name: "name", in: "path", required: true, schema: { type: "string" } }],
        requestBody: { content: { "application/json": { schema: { type: "object", additionalProperties: true } } } },
        responses: { "200": { description: "OK" }, ...writeErrors },
      },
    },
    "/api/v1/records": {
      get: {
        tags: ["Schreiben"],
        summary: "Schema-Discovery: schreibbare Entitäten + Felder",
        description:
          "Generische Schreibschicht. Liefert alle Entitäten mit Feldnamen und Relationen. " +
          "Anlegen: POST /api/v1/records/{entity}. Ändern: PATCH /api/v1/records/{entity}/{id}. Löschen: DELETE …",
        security: [{ bearerAuth: [] }],
        responses: { "200": { description: "OK" }, "401": { description: "Unauthorized" } },
      },
    },
    "/api/v1/records/{entity}": {
      post: {
        tags: ["Schreiben"],
        summary: "Datensatz anlegen (generisch)",
        description: "entity z. B. property, unit, person, lease, charge, payment, meeting, resolution, insurance, user …",
        security: [{ bearerAuth: [] }],
        parameters: [{ name: "entity", in: "path", required: true, schema: { type: "string" } }],
        requestBody: { required: true, content: { "application/json": { schema: { type: "object", additionalProperties: true } } } },
        responses: { "201": { description: "Created" }, ...writeErrors },
      },
    },
    "/api/v1/records/{entity}/{id}": {
      get: {
        tags: ["Lesen"],
        summary: "Einzelnen Datensatz lesen",
        description:
          "entity: property, building, unit, person, lease, ticket, task, contractor, document (nur Metadaten), meeting, charge, " +
          "payment, owner (Alias ownership), appointment, insurance, account, meter, resolution. Feste Feldliste je Entität mit den " +
          "IDs verknüpfter Datensätze, dazu href (Pfad in der App) und apiHref.",
        security: [{ bearerAuth: [] }],
        parameters: [pathParam("entity"), pathParam("id")],
        responses: { "200": { description: "OK", content: { "application/json": { schema: { type: "object" } } } }, "401": R("Unauthorized"), "404": R("NotFound"), "500": R("InternalError") },
      },
      patch: {
        tags: ["Schreiben"],
        summary: "Datensatz ändern (generisch)",
        description:
          "Dokumente (entity document): nur gesendete Felder ändern sich (name, category, propertyId, unitId, personId); null oder \"\" löst eine Zuordnung. " +
          "Andere Entitäten: Felder wie in GET /api/v1/records (Schema-Discovery); am sichersten den vollständigen Datensatz senden " +
          "(vorher mit GET lesen), da nicht gesendete Felder nicht bei jeder Entität unverändert bleiben. " +
          "Dokumente werden über die Operation upload_document angelegt.",
        security: [{ bearerAuth: [] }],
        parameters: [
          { name: "entity", in: "path", required: true, schema: { type: "string" } },
          { name: "id", in: "path", required: true, schema: { type: "string" } },
        ],
        requestBody: { required: true, content: { "application/json": { schema: { type: "object", additionalProperties: true } } } },
        responses: { "200": { description: "OK" }, ...writeErrors, "405": errorResponse("Nicht aktualisierbar") },
      },
      delete: {
        tags: ["Schreiben"],
        summary: "Datensatz löschen (generisch)",
        description:
          "Bei entity document werden Datensatz und Datei endgültig gelöscht. Löschen kaskadiert: ein Objekt löscht Gebäude, Einheiten, " +
          "Verträge, Sollstellungen, Zähler, Versammlungen und Beschlüsse mit; eine Einheit ihre Verträge, Zähler und Eigentümer; " +
          "ein Mietvertrag seine Sollstellungen.",
        security: [{ bearerAuth: [] }],
        parameters: [
          { name: "entity", in: "path", required: true, schema: { type: "string" } },
          { name: "id", in: "path", required: true, schema: { type: "string" } },
        ],
        responses: { "200": { description: "OK" }, ...writeErrors },
      },
    },
    "/api/v1/search": {
      get: {
        tags: ["Lesen"],
        summary: "Suche über Objekte, Einheiten, Personen, Verträge, Tickets, Versammlungen, Handwerker, Dokumente",
        description:
          "Jedes Wort muss in einem der Felder vorkommen (\"Erika Mustermann\" findet Vor- + Nachname). limit gilt je Typ; " +
          "counts enthält die echte Trefferzahl je Typ.",
        security: [{ bearerAuth: [] }],
        parameters: [
          { name: "q", in: "query", required: true, schema: { type: "string", maxLength: 100 } },
          qp("limit", "Treffer je Typ (Standard 10, max. 50)", { type: "integer", minimum: 1, maximum: 50 }),
          qp("entities", "Kommagetrennt, z. B. person,unit"),
        ],
        responses: {
          "200": {
            description: "OK",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    q: { type: "string" },
                    total: { type: "integer" },
                    counts: { type: "object", additionalProperties: { type: "integer" } },
                    hits: { type: "array", items: ref("schemas", "SearchHit") },
                  },
                },
              },
            },
          },
          "400": R("BadRequest"),
          "401": R("Unauthorized"),
        },
      },
    },
    "/api/v1/tasks": {
      get: listOp("Aufgaben", "Aufgaben auflisten", { filters: [qp("done", "true = erledigte, false = offene", { type: "boolean" })] }),
      post: {
        tags: ["Aufgaben"],
        summary: "Aufgabe anlegen",
        security: [{ bearerAuth: [] }],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["title"],
                properties: { title: { type: "string" }, dueDate: { type: "string", format: "date" } },
              },
            },
          },
        },
        responses: { "201": { description: "Created" }, "400": R("BadRequest"), "401": R("Unauthorized"), "500": R("InternalError") },
      },
    },
    "/api/v1/persons": {
      get: listOp("Personen", "Personen auflisten", {
        q: true,
        filters: [qp("type", "Kontaktgruppe", { type: "string", enum: ["MIETER", "EIGENTUEMER", "INTERESSENT", "HANDWERKER", "MAKLER", "BANK", "SONSTIGE"] })],
      }),
      post: {
        tags: ["Personen"],
        summary: "Person anlegen",
        security: [{ bearerAuth: [] }],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["firstName", "lastName"],
                properties: {
                  firstName: { type: "string" },
                  lastName: { type: "string" },
                  email: { type: "string" },
                  phone: { type: "string" },
                  type: { type: "string", enum: ["MIETER", "EIGENTUEMER", "INTERESSENT", "HANDWERKER", "MAKLER", "BANK", "SONSTIGE"] },
                },
              },
            },
          },
        },
        responses: { "201": { description: "Created" }, "400": R("BadRequest"), "401": R("Unauthorized"), "500": R("InternalError") },
      },
    },
    "/api/v1/tickets": {
      get: listOp("Instandhaltung", "Tickets auflisten", {
        q: true,
        filters: [
          qp("status", "Ticket-Status", { type: "string", enum: ["OFFEN", "IN_ARBEIT", "WARTEND", "ERLEDIGT"] }),
          idFilter("propertyId", "Objekt"),
          idFilter("unitId", "Einheit"),
        ],
      }),
      post: {
        tags: ["Instandhaltung"],
        summary: "Ticket anlegen",
        security: [{ bearerAuth: [] }],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["title"],
                properties: {
                  title: { type: "string" },
                  description: { type: "string" },
                  propertyId: { type: "string" },
                  priority: { type: "string", enum: ["NIEDRIG", "MITTEL", "HOCH"] },
                },
              },
            },
          },
        },
        responses: { "201": { description: "Created" }, "400": R("BadRequest"), "401": R("Unauthorized"), "500": R("InternalError") },
      },
    },
  },
};

export function GET() {
  return Response.json(spec);
}
