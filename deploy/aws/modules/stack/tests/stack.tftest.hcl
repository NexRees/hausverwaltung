# Offline checks of the security properties (mock providers, no AWS account needed):
#   terraform init -backend=false && terraform test

mock_provider "aws" {
  override_data {
    target = data.aws_availability_zones.this
    values = { names = ["eu-central-1a", "eu-central-1b", "eu-central-1c"] }
  }
  override_data {
    target = data.aws_region.this
    values = { name = "eu-central-1" }
  }
  override_data {
    target = data.aws_caller_identity.this
    values = { account_id = "123456789012" }
  }
  override_data {
    target = data.aws_iam_policy_document.ecs_assume
    values = { json = "{}" }
  }
  override_data {
    target = data.aws_iam_policy_document.ci_assume
    values = { json = "{}" }
  }
}

mock_provider "random" {}

variables {
  name        = "nexrees-staging"
  environment = "staging"
  domain      = "staging.nexrees.de"
  image       = "ghcr.io/nexrees/hausverwaltung:sha-abc1234"
  users = [
    { email = "admin@nexrees.de", name = "Admin", role = "ADMIN" },
    { email = "verwaltung@nexrees.de", name = "Verwaltung", role = "VERWALTER" },
    { email = "buchhaltung@nexrees.de", name = "Buchhaltung", role = "BUCHHALTUNG" },
  ]
  github_repository = "NexRees/hausverwaltung"
}

run "data_is_private_and_encrypted" {
  command = plan

  assert {
    condition     = aws_db_instance.this.publicly_accessible == false && aws_db_instance.this.storage_encrypted
    error_message = "Database must be private and encrypted."
  }
  assert {
    condition     = one(aws_db_parameter_group.this.parameter).value == "1"
    error_message = "Postgres must force TLS."
  }
  assert {
    condition     = aws_s3_bucket_public_access_block.documents.block_public_acls && aws_s3_bucket_public_access_block.documents.restrict_public_buckets
    error_message = "Documents bucket must block public access."
  }
  assert {
    condition     = one(one(aws_s3_bucket_server_side_encryption_configuration.documents.rule).apply_server_side_encryption_by_default).sse_algorithm == "aws:kms"
    error_message = "Documents must be KMS-encrypted."
  }
  assert {
    condition     = aws_db_subnet_group.this.subnet_ids != null
    error_message = "Database must use the private subnet group."
  }
}

run "app_only_behind_the_load_balancer" {
  command = plan

  assert {
    condition     = aws_vpc_security_group_ingress_rule.app_from_alb.from_port == 3000 && aws_vpc_security_group_ingress_rule.db_from_app.from_port == 5432
    error_message = "App only from the load balancer, database only from the app."
  }
  assert {
    condition     = aws_lb_listener.https.ssl_policy == "ELBSecurityPolicy-TLS13-1-2-2021-06"
    error_message = "HTTPS must use the TLS 1.2+/1.3 policy."
  }
  assert {
    condition     = one(one(aws_lb_listener.http.default_action).redirect).protocol == "HTTPS"
    error_message = "HTTP must redirect to HTTPS."
  }
  assert {
    condition     = length(local.secret_keys) == 4 && !contains(keys(local.environment), "DATABASE_URL")
    error_message = "Secrets must come from Secrets Manager, never plain environment."
  }
}

run "three_staff_logins_with_admin_first" {
  command = plan

  assert {
    condition     = length(random_password.user) == 3 && local.environment.ADMIN_EMAIL == "admin@nexrees.de"
    error_message = "The three staff logins must reach the app, admin first."
  }
}

run "first_user_must_be_admin" {
  command = plan
  variables {
    users = [{ email = "verwaltung@nexrees.de", name = "V", role = "VERWALTER" }]
  }
  expect_failures = [var.users]
}

run "latest_tag_is_refused" {
  command = plan
  variables {
    image = "ghcr.io/nexrees/hausverwaltung:latest"
  }
  expect_failures = [var.image]
}
