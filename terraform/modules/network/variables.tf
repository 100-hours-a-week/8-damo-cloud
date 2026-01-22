variable "name" {
  type        = string
  description = "Name prefix (e.g., dev, prod)"
}

variable "vpc_cidr" {
  type = string
  description = "VPC CIDR (e.g., 10.0.0.0/16)"
}

variable "public_subnets" {
  type = map(object({
    cidr = string
    az   = string
  }))
  description = "Public subnets map. Example: { pub = { cidr=\"10.0.0.0/24\", az=\"...\" } }"
  default     = {}
}

variable "private_subnets" {
  type = map(object({
    cidr = string
    az   = string
  }))
  description = "Private subnets map. Example: { pri1 = {...}, pri2 = {...} }"
  default     = {}
}