variable "aws_region" {
  type    = string
  default = "ap-northeast-2"
}

variable "certificate_arn" {
  description = "ACM certificate ARN for HTTPS listener"
  type        = string
}

variable "instance_ami" {
  description = "AMI ID for instances"
  type        = string
  default     = "ami-04f06fb5ae9dcc778"
}

variable "instance_key_name" {
  description = "Key pair name"
  type        = string
  default     = "damo-key"
}

variable "iam_instance_profile" {
  description = "IAM instance profile name"
  type        = string
  default     = "damo-be-ec2-s3-upload-role"
}

variable "fe_instance_type" {
  type    = string
  default = "t4g.small"
}

variable "fe_desired_capacity" {
  type = number
}

variable "fe_min_size" {
  type = number
}

variable "fe_max_size" {
  type = number
}

variable "be_instance_type" {
  type    = string
  default = "t4g.small"
}

variable "be_desired_capacity" {
  type = number
}

variable "be_min_size" {
  type = number
}

variable "be_max_size" {
  type = number
}

variable "health_check_type" {
  type    = string
  default = "EC2"
}

variable "health_check_grace_period" {
  type    = number
  default = 300
}

variable "scaling_policies_enabled" {
  type    = bool
  default = true
}
