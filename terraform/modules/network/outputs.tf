output "vpc_id" {
  value = data.aws_vpc.this.id
}

output "public_subnet_ids" {
  value = {
    "01" = data.aws_subnet.public_01.id
    "02" = data.aws_subnet.public_02.id
  }
}

output "private_subnet_ids" {
  value = {
    "01" = data.aws_subnet.private_01.id
    "02" = data.aws_subnet.private_02.id
  }
}
