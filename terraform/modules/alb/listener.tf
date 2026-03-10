resource "aws_lb_listener" "https" {
  load_balancer_arn = aws_lb.this.arn
  port              = 443
  protocol          = "HTTPS"
  certificate_arn   = var.certificate_arn
  ssl_policy        = "ELBSecurityPolicy-TLS13-1-2-Res-PQ-2025-09"

  default_action {
    type = "forward"
    forward {
      target_group {
        arn    = aws_lb_target_group.fe_blue.arn
        weight = 1
      }
      target_group {
        arn    = aws_lb_target_group.fe_green.arn
        weight = 0
      }
    }
  }
}

resource "aws_lb_listener_rule" "be_api" {
  listener_arn = aws_lb_listener.https.arn
  priority     = 1

  action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.be.arn
  }

  condition {
    path_pattern {
      values = ["/api/*"]
    }
  }
}
