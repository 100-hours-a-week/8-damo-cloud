resource "aws_lb_target_group" "fe_blue" {
  name        = "prod-fe"
  port        = 3000
  protocol    = "HTTP"
  vpc_id      = var.vpc_id
  target_type = "instance"

  health_check {
    protocol = "HTTP"
    path     = "/api/health"
  }
}

resource "aws_lb_target_group" "fe_green" {
  name        = "prod-fe-green"
  port        = 3000
  protocol    = "HTTP"
  vpc_id      = var.vpc_id
  target_type = "instance"

  health_check {
    protocol = "HTTP"
    path     = "/api/health"
  }
}

resource "aws_lb_target_group" "be" {
  name        = "prod-be"
  port        = 8080
  protocol    = "HTTP"
  vpc_id      = var.vpc_id
  target_type = "instance"

  health_check {
    protocol = "HTTP"
    path     = "/api/healthy"
  }
}
