module "network" {
  source   = "../../modules/network"
  vpc_name = "dev-damo"
}

module "security" {
  source = "../../modules/security"

  name   = "dev-security-group"
  vpc_id = module.network.vpc_id
}

module "ec2" {
  source = "../../modules/ec2"

  name                   = "dev-damo-v1"
  ami                    = var.instance_ami
  instance_type          = "t4g.medium"
  key_name               = var.instance_key_name
  subnet_id              = element(values(module.network.public_subnet_ids), 0)
  vpc_security_group_ids = [module.security.security_group_id]
  iam_instance_profile   = var.iam_instance_profile
}

output "dev_vpc_id" {
  value = module.network.vpc_id
}

output "dev_public_subnet_ids" {
  value = module.network.public_subnet_ids
}

output "dev_private_subnet_ids" {
  value = module.network.private_subnet_ids
}
