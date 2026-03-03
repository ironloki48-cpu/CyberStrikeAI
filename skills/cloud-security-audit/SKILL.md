---
name: cloud-security-audit
description: Professional skills and methodology for cloud security auditing
version: 1.0.0
---

# Cloud Security Audit

## Overview

Cloud security auditing is an essential part of evaluating the security of cloud environments. This skill provides methods, tools, and best practices for cloud security auditing, covering major cloud platforms such as AWS, Azure, and GCP.

## Audit Scope

### 1. Identity and Access Management

**Checklist:**
- IAM policy configuration
- User permissions
- Role permissions
- Access key management

### 2. Network Security

**Checklist:**
- Security group configuration
- Network ACL
- VPC configuration
- Traffic encryption

### 3. Data Security

**Checklist:**
- Data encryption
- Key management
- Backup policy
- Data classification

### 4. Compliance

**Checklist:**
- Compliance frameworks
- Audit logs
- Monitoring and alerting
- Incident response

## AWS Security Audit

### IAM Audit

**Check IAM policies:**
```bash
# List all IAM users
aws iam list-users

# List all IAM policies
aws iam list-policies

# Check user permissions
aws iam list-user-policies --user-name username
aws iam list-attached-user-policies --user-name username

# Check role permissions
aws iam list-role-policies --role-name rolename
```

**Common issues:**
- Excessive permissions
- Unused access keys
- Weak password policy
- MFA not enabled

### S3 Security Audit

**Check S3 buckets:**
```bash
# List all buckets
aws s3 ls

# Check bucket policy
aws s3api get-bucket-policy --bucket bucketname

# Check bucket ACL
aws s3api get-bucket-acl --bucket bucketname

# Check bucket encryption
aws s3api get-bucket-encryption --bucket bucketname
```

**Common issues:**
- Public access
- Unencrypted
- Versioning not enabled
- Logging not enabled

### Security Group Audit

**Check security groups:**
```bash
# List all security groups
aws ec2 describe-security-groups

# Check open ports
aws ec2 describe-security-groups --group-ids sg-xxx
```

**Common issues:**
- 0.0.0.0/0 open
- Unnecessary open ports
- Overly permissive rules

### CloudTrail Audit

**Check audit logs:**
```bash
# List all trails
aws cloudtrail describe-trails

# Check log file integrity
aws cloudtrail get-trail-status --name trailname
```

## Azure Security Audit

### Subscriptions and Resource Groups

**Check subscriptions:**
```bash
# List all subscriptions
az account list

# Check resource groups
az group list
```

### Network Security Groups

**Check NSG:**
```bash
# List all NSGs
az network nsg list

# Check NSG rules
az network nsg rule list --nsg-name nsgname --resource-group rgname
```

### Storage Accounts

**Check storage accounts:**
```bash
# List all storage accounts
az storage account list

# Check access policies
az storage account show --name accountname --resource-group rgname
```

## GCP Security Audit

### Projects and Organizations

**Check projects:**
```bash
# List all projects
gcloud projects list

# Check IAM policies
gcloud projects get-iam-policy project-id
```

### Compute Engine

**Check instances:**
```bash
# List all instances
gcloud compute instances list

# Check firewall rules
gcloud compute firewall-rules list
```

### Storage

**Check buckets:**
```bash
# List all buckets
gsutil ls

# Check bucket permissions
gsutil iam get gs://bucketname
```

## Automated Tools

### Scout Suite

```bash
# AWS audit
scout aws

# Azure audit
scout azure

# GCP audit
scout gcp
```

### Prowler

```bash
# AWS security audit
prowler -c check11,check12,check13

# Full audit
prowler
```

### CloudSploit

```bash
# Scan AWS account
cloudsploit scan aws

# Scan Azure subscription
cloudsploit scan azure
```

### Pacu

```bash
# AWS penetration testing framework
pacu
```

## Audit Checklist

### IAM Security
- [ ] Check user permissions
- [ ] Check role permissions
- [ ] Check access keys
- [ ] Check password policy
- [ ] Check MFA status

### Network Security
- [ ] Check security group/NSG rules
- [ ] Check VPC configuration
- [ ] Check network ACL
- [ ] Check traffic encryption

### Data Security
- [ ] Check data encryption
- [ ] Check key management
- [ ] Check backup policy
- [ ] Check data classification

### Compliance
- [ ] Check audit logs
- [ ] Check monitoring and alerting
- [ ] Check incident response
- [ ] Check compliance frameworks

## Common Security Issues

### 1. Excessive Permissions

**Issue:**
- IAM policies too permissive
- Users have administrator privileges
- Role permissions too broad

**Remediation:**
- Principle of least privilege
- Regularly review permissions
- Use IAM policy simulation

### 2. Public Resources

**Issue:**
- S3 buckets publicly accessible
- Security groups open to 0.0.0.0/0
- Databases publicly accessible

**Remediation:**
- Restrict access scope
- Use private networks
- Enable access controls

### 3. Unencrypted Data

**Issue:**
- Storage unencrypted
- Transmission unencrypted
- Improper key management

**Remediation:**
- Enable encryption
- Use TLS/SSL
- Use key management services

### 4. Missing Logs

**Issue:**
- Audit logs not enabled
- Logs not retained
- Logs not monitored

**Remediation:**
- Enable CloudTrail/Azure Monitor
- Set log retention policies
- Configure monitoring and alerting

## Best Practices

### 1. Least Privilege

- Grant only necessary permissions
- Regularly review permissions
- Use IAM policy simulation

### 2. Defense in Depth

- Network layer protection
- Application layer protection
- Data layer protection

### 3. Monitoring and Alerting

- Enable audit logs
- Configure monitoring and alerting
- Establish incident response processes

### 4. Compliance

- Follow compliance frameworks
- Regular security audits
- Document security policies

## Notes

- Only perform audits in authorized environments
- Avoid impacting production environments
- Note differences across cloud platforms
- Conduct security audits regularly
