output "url" {
  value = "https://${var.domain}"
}

output "dns_records_for_inwx" {
  description = "Add these at INWX (nexrees.de zone). The certificate CNAME first: apply waits for it."
  value = concat(
    [for o in aws_acm_certificate.this.domain_validation_options : {
      purpose = "certificate validation"
      name    = o.resource_record_name
      type    = o.resource_record_type
      value   = o.resource_record_value
    }],
    [{
      purpose = "app hostname"
      name    = "${var.domain}."
      type    = "CNAME"
      value   = aws_lb.this.dns_name
    }],
  )
}

output "app_secret_name" {
  description = "Logins: aws secretsmanager get-secret-value --secret-id <this> --query SecretString"
  value       = aws_secretsmanager_secret.app.name
}

output "logins" {
  description = "Staff logins (passwords are in the app secret, key NEXREES_USERS)."
  value       = [for u in var.users : "${u.email} (${u.role})"]
}

output "ecs" {
  value = { cluster = aws_ecs_cluster.this.name, service = aws_ecs_service.app.name, task_family = aws_ecs_task_definition.app.family }
}

output "deploy_role_arn" {
  value = local.ci_enabled ? aws_iam_role.ci[0].arn : null
}

output "documents_bucket" {
  value = aws_s3_bucket.documents.bucket
}
