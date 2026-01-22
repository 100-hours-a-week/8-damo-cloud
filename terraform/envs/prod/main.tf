module "network" {
  source = "../../modules/network"

  name            = "prod"
  vpc_cidr        = var.vpc_cidr
  public_subnets  = var.public_subnets
  private_subnets = var.private_subnets
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