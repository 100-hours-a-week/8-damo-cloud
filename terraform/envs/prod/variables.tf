variable "aws_region" {
  type    = string
  default = "ap-northeast-2"
}

variable "vpc_cidr" {
  type = string
}

variable "public_subnets" {
  type = map(object({
    cidr = string
    az   = string
  }))
}

variable "private_subnets" {
  type = map(object({
    cidr = string
    az   = string
  }))
}

variable "instance_ami" {
  description = "AMI ID for the EC2 instance"
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