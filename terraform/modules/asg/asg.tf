resource "aws_autoscaling_group" "fe" {
  name                      = "prod-fe-asg"
  vpc_zone_identifier       = [var.private_subnet_id]
  desired_capacity          = var.fe_desired_capacity
  min_size                  = var.fe_min_size
  max_size                  = var.fe_max_size
  health_check_type         = var.health_check_type
  health_check_grace_period = var.health_check_grace_period
  target_group_arns         = [var.fe_tg_arn]

  launch_template {
    id      = data.aws_launch_template.fe.id
    version = "$Latest"
  }

  tag {
    key                 = "Name"
    value               = "prod-fe"
    propagate_at_launch = true
  }
}


resource "aws_autoscaling_group" "be" {
  name                      = "prod-be-asg"
  vpc_zone_identifier       = [var.private_subnet_id]
  desired_capacity          = var.be_desired_capacity
  min_size                  = var.be_min_size
  max_size                  = var.be_max_size
  health_check_type         = var.health_check_type
  health_check_grace_period = var.health_check_grace_period
  target_group_arns         = [var.be_tg_arn]

  launch_template {
    id      = data.aws_launch_template.be.id
    version = "$Latest"
  }

  tag {
    key                 = "Name"
    value               = "prod-be"
    propagate_at_launch = true
  }
}
