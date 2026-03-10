variable "vpc_id" {
  type = string
}

variable "public_subnet_ids" {
  type = map(string)
}

variable "certificate_arn" {
  type = string
}

variable "alb_sg_name" {
  type        = string
  description = "Security group name for ALB"
}
