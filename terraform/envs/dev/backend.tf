terraform {
  backend "s3" {
    bucket         = "damo-terraform-state-dev"
    key            = "terraform/dev/terraform.tfstate"
    region         = "ap-northeast-2"
    dynamodb_table = "damo-terraform-lock-dev"
    encrypt        = true
  }
}