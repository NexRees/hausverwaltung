variable "name" {
  description = "Stack name, used as prefix for every resource (e.g. nexrees-staging)."
  type        = string
}

variable "environment" {
  description = "staging or production."
  type        = string
  validation {
    condition     = contains(["staging", "production"], var.environment)
    error_message = "environment must be staging or production."
  }
}

variable "domain" {
  description = "Public hostname of this stack, e.g. staging.nexrees.de. DNS stays at INWX."
  type        = string
}

variable "image" {
  description = "Container image with an immutable tag (sha-<short> or a digest), e.g. ghcr.io/nexrees/hausverwaltung:sha-1a2b3c4."
  type        = string
  validation {
    condition     = !endswith(var.image, ":latest")
    error_message = "Use an immutable tag, not :latest."
  }
}

variable "vpc_cidr" {
  type    = string
  default = "10.40.0.0/16"
}

variable "allowed_cidrs" {
  description = "Who may reach the load balancer. Staging: office/VPN ranges once known."
  type        = list(string)
  default     = ["0.0.0.0/0"]
}

variable "tenant_name" {
  description = "Name of the first tenant created on an empty database."
  type        = string
  default     = "NexRees"
}

variable "users" {
  description = "Staff logins created on start (passwords are generated and kept in Secrets Manager). The first one is the instance admin."
  type = list(object({
    email = string
    name  = string
    role  = string
  }))
  validation {
    condition     = length(var.users) > 0 && var.users[0].role == "ADMIN"
    error_message = "The first user is the instance admin and needs role ADMIN."
  }
  validation {
    condition     = alltrue([for u in var.users : contains(["ADMIN", "VERWALTER", "BUCHHALTUNG", "BEIRAT", "EIGENTUEMER", "MIETER", "HANDWERKER"], u.role)])
    error_message = "Unknown role (see enum UserRole in prisma/schema.prisma)."
  }
}

variable "db_instance_class" {
  type    = string
  default = "db.t4g.micro"
}

variable "db_multi_az" {
  type    = bool
  default = false
}

variable "db_backup_days" {
  type    = number
  default = 7
}

variable "deletion_protection" {
  type    = bool
  default = false
}

variable "task_cpu" {
  type    = number
  default = 512
}

variable "task_memory" {
  type    = number
  default = 1024
}

variable "desired_count" {
  description = "Running app tasks. Keep 1 until the in-app scheduler runs on one task only (HAVEWA_DISABLE_SCHEDULER on the others)."
  type        = number
  default     = 1
}

variable "log_retention_days" {
  type    = number
  default = 30
}

variable "extra_environment" {
  description = "Further plain environment variables for the app (no secrets)."
  type        = map(string)
  default     = {}
}

variable "github_repository" {
  description = "owner/repo allowed to deploy through GitHub Actions OIDC. Empty = no deploy role."
  type        = string
  default     = ""
}

variable "github_ids" {
  description = <<-EOT
    Numeric GitHub owner and repository IDs, for repositories with GitHub's immutable OIDC
    subject (repo:OWNER@OWNER_ID/REPO@REPO_ID:...). The deploy role then trusts only that
    exact repository, even if another one later takes over its name. null = plain subject.
    EOT
  type        = object({ owner = number, repository = number })
  default     = null
}

variable "github_oidc_provider_arn" {
  description = "Existing GitHub OIDC provider ARN in this account; empty = create one."
  type        = string
  default     = ""
}

variable "sso" {
  description = <<-EOT
    Company sign-in over OpenID Connect (e.g. Google Workspace), or null for e-mail and password only.
    auto_provision_domains: verified accounts on these domains get a user on first sign-in, with
    default_role (never ADMIN). Empty list = only existing users may sign in with SSO.
  EOT
  type = object({
    name                   = string
    issuer                 = string
    client_id              = string
    auto_provision_domains = optional(list(string), [])
    default_role           = optional(string, "VERWALTER")
  })
  default = null
  validation {
    condition     = var.sso == null || contains(["VERWALTER", "BUCHHALTUNG", "BEIRAT", "HANDWERKER"], try(var.sso.default_role, ""))
    error_message = "sso.default_role must be VERWALTER, BUCHHALTUNG, BEIRAT or HANDWERKER (never ADMIN)."
  }
  validation {
    condition     = var.sso == null || startswith(try(var.sso.issuer, ""), "https://")
    error_message = "sso.issuer must be an https URL."
  }
}

variable "sso_client_secret" {
  description = "OIDC client secret for var.sso. Stored only in Secrets Manager (and the Terraform state)."
  type        = string
  default     = ""
  sensitive   = true
  validation {
    condition     = var.sso == null || length(var.sso_client_secret) > 0
    error_message = "sso_client_secret is required when sso is set."
  }
}

variable "budget_monthly_usd" {
  description = "Monthly cost budget for NexRees in this account, in USD (AWS budgets are in USD), before credits."
  type        = number
  default     = 90
  validation {
    condition     = var.budget_monthly_usd > 0
    error_message = "budget_monthly_usd must be positive."
  }
}

variable "budget_emails" {
  description = "Who gets the budget alerts (50/80/100 % actual, 100 % forecast). Empty = no budget."
  type        = list(string)
  default     = []
}
