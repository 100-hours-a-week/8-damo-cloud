module "network" {
  source   = "../../modules/network"
  vpc_name = "prod-damo"
}

module "security" {
  source = "../../modules/security"

  name   = "prod-damo-public"
  vpc_id = module.network.vpc_id
}

module "ec2" {
  source = "../../modules/ec2"

  name                   = "prod-damo-v1"
  ami                    = var.instance_ami
  instance_type          = "t4g.medium"
  key_name               = var.instance_key_name
  subnet_id              = element(values(module.network.public_subnet_ids), 0)
  vpc_security_group_ids = [module.security.security_group_id]
  iam_instance_profile   = var.iam_instance_profile
}

output "prod_vpc_id" {
  value = module.network.vpc_id
}

output "prod_public_subnet_ids" {
  value = module.network.public_subnet_ids
}

output "prod_private_subnet_ids" {
  value = module.network.private_subnet_ids
}
