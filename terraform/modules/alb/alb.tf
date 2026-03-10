data "aws_security_group" "alb" {
  name   = var.alb_sg_name
  vpc_id = var.vpc_id
}

resource "aws_lb" "this" {
  name               = "prod-alb"
  internal           = false
  load_balancer_type = "application"
  ip_address_type    = "ipv4"
  security_groups    = [data.aws_security_group.alb.id]
  subnets            = [var.public_subnet_ids["01"], var.public_subnet_ids["02"]]

  tags = {
    Name = "prod-alb"
  }
}
