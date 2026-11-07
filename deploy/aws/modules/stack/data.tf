# Data layer: one KMS key per stack for the database, documents, logs and secrets.

data "aws_caller_identity" "this" {}
data "aws_region" "this" {}

resource "aws_kms_key" "data" {
  description             = "${var.name}: database, documents, logs, secrets"
  enable_key_rotation     = true
  deletion_window_in_days = 30
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid       = "AccountAdmin"
        Effect    = "Allow"
        Principal = { AWS = "arn:aws:iam::${data.aws_caller_identity.this.account_id}:root" }
        Action    = "kms:*"
        Resource  = "*"
      },
      {
        Sid       = "CloudWatchLogs"
        Effect    = "Allow"
        Principal = { Service = "logs.${data.aws_region.this.name}.amazonaws.com" }
        Action    = ["kms:Encrypt*", "kms:Decrypt*", "kms:ReEncrypt*", "kms:GenerateDataKey*", "kms:Describe*"]
        Resource  = "*"
        Condition = { ArnLike = { "kms:EncryptionContext:aws:logs:arn" = "arn:aws:logs:${data.aws_region.this.name}:${data.aws_caller_identity.this.account_id}:*" } }
      },
    ]
  })
}

resource "aws_kms_alias" "data" {
  name          = "alias/${var.name}"
  target_key_id = aws_kms_key.data.key_id
}

# --- Postgres ---

# Hex-only password: it goes into DATABASE_URL unescaped (see upstream .env.prod.example).
# It is kept in Terraform state, so the state bucket must stay private and encrypted.
resource "random_password" "db" {
  length  = 40
  special = false
  upper   = false
}

resource "aws_db_subnet_group" "this" {
  name       = var.name
  subnet_ids = aws_subnet.private[*].id
}

resource "aws_db_parameter_group" "this" {
  name   = var.name
  family = "postgres16"
  parameter {
    name  = "rds.force_ssl"
    value = "1"
  }
}

resource "aws_db_instance" "this" {
  identifier                      = var.name
  engine                          = "postgres"
  engine_version                  = "16"
  instance_class                  = var.db_instance_class
  allocated_storage               = 20
  max_allocated_storage           = 100
  storage_type                    = "gp3"
  storage_encrypted               = true
  kms_key_id                      = aws_kms_key.data.arn
  db_name                         = "havewa"
  username                        = "havewa"
  password                        = random_password.db.result
  db_subnet_group_name            = aws_db_subnet_group.this.name
  parameter_group_name            = aws_db_parameter_group.this.name
  vpc_security_group_ids          = [aws_security_group.db.id]
  publicly_accessible             = false
  multi_az                        = var.db_multi_az
  backup_retention_period         = var.db_backup_days
  deletion_protection             = var.deletion_protection
  skip_final_snapshot             = !var.deletion_protection
  final_snapshot_identifier       = var.deletion_protection ? "${var.name}-final" : null
  copy_tags_to_snapshot           = true
  auto_minor_version_upgrade      = true
  enabled_cloudwatch_logs_exports = ["postgresql"]
  apply_immediately               = var.environment == "staging"
}

# --- Documents (S3) ---

resource "aws_s3_bucket" "documents" {
  bucket        = "${var.name}-documents-${data.aws_caller_identity.this.account_id}"
  force_destroy = var.environment == "staging"
}

resource "aws_s3_bucket_public_access_block" "documents" {
  bucket                  = aws_s3_bucket.documents.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_ownership_controls" "documents" {
  bucket = aws_s3_bucket.documents.id
  rule {
    object_ownership = "BucketOwnerEnforced"
  }
}

resource "aws_s3_bucket_versioning" "documents" {
  bucket = aws_s3_bucket.documents.id
  versioning_configuration {
    status = "Enabled"
  }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "documents" {
  bucket = aws_s3_bucket.documents.id
  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm     = "aws:kms"
      kms_master_key_id = aws_kms_key.data.arn
    }
    bucket_key_enabled = true
  }
}

resource "aws_s3_bucket_lifecycle_configuration" "documents" {
  bucket = aws_s3_bucket.documents.id
  rule {
    id     = "expire-old-versions"
    status = "Enabled"
    filter {}
    noncurrent_version_expiration {
      noncurrent_days = var.environment == "staging" ? 7 : 90
    }
  }
}

resource "aws_s3_bucket_policy" "documents_tls_only" {
  bucket = aws_s3_bucket.documents.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Sid       = "DenyInsecureTransport"
      Effect    = "Deny"
      Principal = "*"
      Action    = "s3:*"
      Resource  = [aws_s3_bucket.documents.arn, "${aws_s3_bucket.documents.arn}/*"]
      Condition = { Bool = { "aws:SecureTransport" = "false" } }
    }]
  })
  depends_on = [aws_s3_bucket_public_access_block.documents]
}

# --- Secrets (values generated here; read them with `aws secretsmanager get-secret-value`) ---

resource "random_password" "auth_secret" {
  length  = 48
  special = false
}

resource "random_password" "user" {
  for_each = { for u in var.users : u.email => u }
  length   = 20
  special  = false
}

locals {
  admin = var.users[0]
  users_json = jsonencode([for u in var.users : {
    email    = u.email
    name     = u.name
    role     = u.role
    password = random_password.user[u.email].result
  }])
  app_secrets = merge({
    DATABASE_URL   = "postgresql://havewa:${random_password.db.result}@${aws_db_instance.this.address}:5432/havewa?schema=public&sslmode=require"
    AUTH_SECRET    = random_password.auth_secret.result
    ADMIN_PASSWORD = random_password.user[local.admin.email].result
    NEXREES_USERS  = local.users_json
  }, var.sso == null ? {} : { OIDC_CLIENT_SECRET = var.sso_client_secret })
}

resource "aws_secretsmanager_secret" "app" {
  name                    = "${var.name}/app"
  description             = "Runtime secrets of ${var.name} (JSON keys = env var names)"
  kms_key_id              = aws_kms_key.data.arn
  recovery_window_in_days = var.environment == "staging" ? 0 : 30
}

resource "aws_secretsmanager_secret_version" "app" {
  secret_id     = aws_secretsmanager_secret.app.id
  secret_string = jsonencode(local.app_secrets)
}

# Residency guard: everything that holds or processes data (database, documents, logs,
# secrets, containers, load balancer) lives in Frankfurt only. Plan and apply stop if the
# provider points at any other region. Only AWS's global control plane (IAM roles, the
# GitHub OIDC provider, the cost budget) sits outside a region, and none of it holds
# customer data.
resource "terraform_data" "region_guard" {
  input = data.aws_region.this.name

  lifecycle {
    precondition {
      condition     = data.aws_region.this.name == "eu-central-1"
      error_message = "NexRees runs only in AWS Frankfurt (eu-central-1)."
    }
  }
}
