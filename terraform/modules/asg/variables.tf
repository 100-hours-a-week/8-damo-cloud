variable "vpc_id" {
  type = string
}

variable "private_subnet_id" {
  type        = string
  description = "Private subnet ID (private-01)"
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

variable "fe_tg_arn" {
  type = string
}

variable "be_tg_arn" {
  type = string
}
