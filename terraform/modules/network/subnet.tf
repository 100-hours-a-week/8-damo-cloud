data "aws_subnet" "public_01" {
  filter {
    name   = "tag:Name"
    values = ["${var.vpc_name}-public-01"]
  }
}

data "aws_subnet" "public_02" {
  filter {
    name   = "tag:Name"
    values = ["${var.vpc_name}-public-02"]
  }
}

data "aws_subnet" "private_01" {
  filter {
    name   = "tag:Name"
    values = ["${var.vpc_name}-private-01"]
  }
}

data "aws_subnet" "private_02" {
  filter {
    name   = "tag:Name"
    values = ["${var.vpc_name}-private-02"]
  }
}
