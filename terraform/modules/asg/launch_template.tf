data "aws_security_group" "fe" {
  name   = "prod-damo-fe-sg20260211073027300400000004"
  vpc_id = var.vpc_id
}

data "aws_security_group" "be" {
  name   = "prod-damo-be-sg20260211073027300400000005"
  vpc_id = var.vpc_id
}

data "aws_launch_template" "fe" {
  name = "prod-fe-template"
}

data "aws_launch_template" "be" {
  name = "prod-be-template"
}
