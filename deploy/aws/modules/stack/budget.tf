# Cost guard: e-mail when this stack's month runs hot. Counts usage before credits, so the
# alerts track how fast the promotional credit is being used up, not the (zero) invoice.
# Filtered on the Environment tag every resource here carries (provider default_tags), so
# staging and production get separate budgets even in one account. Activate the cost
# allocation tag "Environment" once in Billing → Cost allocation tags (takes up to 24 h).

resource "aws_budgets_budget" "monthly" {
  count        = length(var.budget_emails) > 0 ? 1 : 0
  name         = "${var.name}-monthly"
  budget_type  = "COST"
  limit_amount = tostring(var.budget_monthly_usd)
  limit_unit   = "USD"
  time_unit    = "MONTHLY"

  cost_filter {
    name   = "TagKeyValue"
    values = [format("user:Environment$%s", var.environment)]
  }

  cost_types {
    include_credit = false
    include_refund = false
  }

  dynamic "notification" {
    for_each = [50, 80, 100]
    content {
      comparison_operator        = "GREATER_THAN"
      threshold                  = notification.value
      threshold_type             = "PERCENTAGE"
      notification_type          = "ACTUAL"
      subscriber_email_addresses = var.budget_emails
    }
  }

  notification {
    comparison_operator        = "GREATER_THAN"
    threshold                  = 100
    threshold_type             = "PERCENTAGE"
    notification_type          = "FORECASTED"
    subscriber_email_addresses = var.budget_emails
  }
}
