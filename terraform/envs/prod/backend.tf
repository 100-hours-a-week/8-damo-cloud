terraform {
  backend "s3" {
    bucket         = "damo-terraform-state-prod"
    key            = "terraform/prod/terraform.tfstate"
    region         = "ap-northeast-2"
    dynamodb_table = "damo-terraform-lock-prod"
    encrypt        = true
  }
}