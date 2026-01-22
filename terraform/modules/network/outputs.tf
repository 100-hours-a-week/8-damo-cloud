output "vpc_id" {
  value = aws_vpc.this.id
}

# map 형태로 반환(키 = pub1/pri1/pri2 .. )
output "public_subnet_ids" {
  value = { for k, s in aws_subnet.public : k => s.id }
}

output "private_subnet_ids" {
  value = { for k, s in aws_subnet.private : k => s.id }
}