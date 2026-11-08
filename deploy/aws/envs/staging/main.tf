# NexRees staging: staging.nexrees.de in AWS Frankfurt.
# State lives in an S3 bucket created once by hand (see deploy/aws/README.md).

terraform {
  required_version = ">= 1.9"
  backend "s3" {
    key          = "nexrees-hv/staging.tfstate"
    region       = "eu-central-1"
    encrypt      = true
    use_lockfile = true
    # bucket = passed at init: terraform init -backend-config="bucket=<state bucket>"
  }
  required_providers {
    aws    = { source = "hashicorp/aws", version = "~> 5.80" }
    random = { source = "hashicorp/random", version = "~> 3.6" }
  }
}

# Safety: this configuration only ever runs against the NexRees AWS account. Terraform stops
# before touching anything when the logged-in profile belongs to another account.
variable "aws_account_id" {
  description = "12-digit ID of the NexRees AWS account."
  type        = string
  validation {
    condition     = can(regex("^[0-9]{12}$", var.aws_account_id))
    error_message = "aws_account_id must be the 12-digit AWS account ID."
  }
}

variable "aws_profile" {
  description = "AWS CLI profile to use (aws configure sso --profile nexrees)."
  type        = string
  default     = "nexrees"
}

provider "aws" {
  region              = "eu-central-1"
  profile             = var.aws_profile
  allowed_account_ids = [var.aws_account_id]
  default_tags {
    tags = {
      Project     = "nexrees-hv"
      Environment = "staging"
      ManagedBy   = "terraform"
      Repository  = "NexRees/hausverwaltung"
    }
  }
}

variable "image" {
  description = "First image to run, e.g. ghcr.io/nexrees/hausverwaltung:sha-1a2b3c4. Later images come from CI."
  type        = string
}

# Google Workspace sign-in (deploy/aws/README.md "Company sign-in"). Empty = off.
variable "google_client_id" {
  type    = string
  default = ""
}

variable "google_client_secret" {
  type      = string
  default   = ""
  sensitive = true
}

# Budget alerts. ~€200 credit / staging at ~$70-90 a month ≈ 2.5 months of runway.
variable "budget_emails" {
  description = "Who gets the budget alerts (kept out of this public repo; pass with -var or TF_VAR_budget_emails)."
  type        = list(string)
  validation {
    condition     = length(var.budget_emails) > 0
    error_message = "Give at least one address for the budget alerts."
  }
}

# Set when this account already has a GitHub OIDC provider (e.g. production deployed first).
variable "github_oidc_provider_arn" {
  type    = string
  default = ""
}

variable "allowed_cidrs" {
  type    = list(string)
  default = ["0.0.0.0/0"]
}

module "stack" {
  source        = "../../modules/stack"
  name          = "nexrees-staging"
  environment   = "staging"
  domain        = "staging.nexrees.de"
  image         = var.image
  allowed_cidrs = var.allowed_cidrs
  tenant_name   = "NexRees"

  # Three staff logins to start with (Abi, 2026-11-06).
  users = [
    { email = "admin@nexrees.de", name = "NexRees Admin", role = "ADMIN" },
    { email = "verwaltung@nexrees.de", name = "Verwaltung", role = "VERWALTER" },
    { email = "buchhaltung@nexrees.de", name = "Buchhaltung", role = "BUCHHALTUNG" },
  ]

  extra_environment = {
    # Staging never sends real mail: no SMTP is configured, so the outbox stays in the app.
    HAVEWA_DISABLE_SCHEDULER = "false"
  }

  # Everyone with a NexRees Google Workspace account can sign in; first sign-in creates the user.
  sso = var.google_client_id == "" ? null : {
    name                   = "Google"
    issuer                 = "https://accounts.google.com"
    client_id              = var.google_client_id
    auto_provision_domains = ["nexrees.de"]
    default_role           = "VERWALTER"
  }
  sso_client_secret = var.google_client_secret

  github_repository        = "NexRees/hausverwaltung"
  github_oidc_provider_arn = var.github_oidc_provider_arn
  # The repository uses GitHub's immutable OIDC subject: pin owner and repository IDs.
  github_ids = { owner = 349533634, repository = 1448272854 }

  budget_monthly_usd = 90
  budget_emails      = var.budget_emails
}

output "stack" {
  value = module.stack
}
