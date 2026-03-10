output "fe_asg_name" {
  value = aws_autoscaling_group.fe.name
}

output "be_asg_name" {
  value = aws_autoscaling_group.be.name
}
