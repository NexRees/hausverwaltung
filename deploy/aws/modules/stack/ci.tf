# GitHub Actions deploy role (OIDC, no stored AWS keys). Only jobs of the given repository
# that run in the GitHub environment of the same name (staging / production) may assume it,
# so that environment's protection rules (branch main; reviewers for production) guard AWS
# too. The role may only roll this stack's service to a new task revision.

locals {
  ci_enabled = var.github_repository != ""
  # A job with `environment: X` gets this subject claim from GitHub instead of the branch ref.
  ci_subject = "repo:${var.github_repository}:environment:${var.environment}"
}

resource "aws_iam_openid_connect_provider" "github" {
  count           = local.ci_enabled && var.github_oidc_provider_arn == "" ? 1 : 0
  url             = "https://token.actions.githubusercontent.com"
  client_id_list  = ["sts.amazonaws.com"]
  thumbprint_list = ["6938fd4d98bab03faadb97b34396831e3780aea1"]
}

data "aws_iam_policy_document" "ci_assume" {
  count = local.ci_enabled ? 1 : 0
  statement {
    actions = ["sts:AssumeRoleWithWebIdentity"]
    principals {
      type        = "Federated"
      identifiers = [var.github_oidc_provider_arn != "" ? var.github_oidc_provider_arn : aws_iam_openid_connect_provider.github[0].arn]
    }
    condition {
      test     = "StringEquals"
      variable = "token.actions.githubusercontent.com:aud"
      values   = ["sts.amazonaws.com"]
    }
    condition {
      test     = "StringEquals"
      variable = "token.actions.githubusercontent.com:sub"
      values   = [local.ci_subject]
    }
  }
}

resource "aws_iam_role" "ci" {
  count              = local.ci_enabled ? 1 : 0
  name               = "${var.name}-deploy"
  assume_role_policy = data.aws_iam_policy_document.ci_assume[0].json
}

resource "aws_iam_role_policy" "ci" {
  count = local.ci_enabled ? 1 : 0
  name  = "deploy-app-service"
  role  = aws_iam_role.ci[0].id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      { Effect = "Allow", Action = ["ecs:DescribeTaskDefinition", "ecs:RegisterTaskDefinition"], Resource = "*" },
      { Effect = "Allow", Action = ["ecs:UpdateService", "ecs:DescribeServices"], Resource = aws_ecs_service.app.id },
      { Effect = "Allow", Action = "iam:PassRole", Resource = [aws_iam_role.execution.arn, aws_iam_role.task.arn] },
    ]
  })
}
