output "alb_arn" {
  value = aws_lb.this.arn
}

output "alb_dns_name" {
  value = aws_lb.this.dns_name
}

output "fe_blue_tg_arn" {
  value = aws_lb_target_group.fe_blue.arn
}

output "fe_green_tg_arn" {
  value = aws_lb_target_group.fe_green.arn
}

output "be_tg_arn" {
  value = aws_lb_target_group.be.arn
}
