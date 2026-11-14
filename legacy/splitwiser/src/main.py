from datetime import datetime
from typing import Dict, List, Optional
from dataclasses import dataclass, field
from enum import Enum
import uuid

class SplitType(Enum):
    EQUAL = "equal"
    EXACT = "exact"
    PERCENTAGE = "percentage"


@dataclass
class User:
    """Represents a user in the expense splitting system"""
    id: str = field(default_factory=lambda: str(uuid.uuid4()))
    name: str = ""
    email: str = ""
    created_at: datetime = field(default_factory=datetime.now)
    
    def __post_init__(self):
        if not self.name:
            raise ValueError("User name cannot be empty")


@dataclass
class Split:
    """Represents how an expense is split among users"""
    user_id: str
    amount: float = 0.0
    percentage: float = 0.0
    
    def __post_init__(self):
        if self.amount < 0:
            raise ValueError("Split amount cannot be negative")
        if not (0 <= self.percentage <= 100):
            self.percentage = 0


@dataclass
class Expense:
    """Represents a shared expense"""
    id: str = field(default_factory=lambda: str(uuid.uuid4()))
    description: str = ""
    amount: float = 0.0
    paid_by: str = ""  # user_id who paid
    group_id: Optional[str] = None
    split_type: SplitType = SplitType.EQUAL
    splits: List[Split] = field(default_factory=list)
    created_at: datetime = field(default_factory=datetime.now)
    category: str = "General"
    
    def __post_init__(self):
        if self.amount <= 0:
            raise ValueError("Expense amount must be positive")
        if not self.description:
            raise ValueError("Expense description cannot be empty")


@dataclass
class Group:
    """Represents a group of users who share expenses"""
    id: str = field(default_factory=lambda: str(uuid.uuid4()))
    name: str = ""
    description: str = ""
    members: List[str] = field(default_factory=list)  # user_ids
    created_by: str = ""  # user_id
    created_at: datetime = field(default_factory=datetime.now)
    
    def __post_init__(self):
        if not self.name:
            raise ValueError("Group name cannot be empty")


class ExpenseSplitter:
    """Main class for managing users, groups, and expenses"""
    
    def __init__(self):
        self.users: Dict[str, User] = {}
        self.groups: Dict[str, Group] = {}
        self.expenses: Dict[str, Expense] = {}
    
    # User Management
    def create_user(self, name: str, email: str = "") -> User:
        """Create a new user"""
        user = User(name=name, email=email)
        self.users[user.id] = user
        return user
    
    def get_user(self, user_id: str) -> Optional[User]:
        """Get user by ID"""
        return self.users.get(user_id)
    
    def get_user_by_name(self, name: str) -> Optional[User]:
        """Get user by name"""
        for user in self.users.values():
            if user.name.lower() == name.lower():
                return user
        return None
    
    # Group Management
    def create_group(self, name: str, created_by: str, description: str = "") -> Group:
        """Create a new group"""
        if created_by not in self.users:
            raise ValueError("Creator must be a valid user")
        
        group = Group(name=name, description=description, created_by=created_by)
        group.members.append(created_by)  # Creator is automatically a member
        self.groups[group.id] = group
        return group
    
    def add_user_to_group(self, group_id: str, user_id: str) -> bool:
        """Add a user to a group"""
        if group_id not in self.groups or user_id not in self.users:
            return False
        
        group = self.groups[group_id]
        if user_id not in group.members:
            group.members.append(user_id)
        return True
    
    def remove_user_from_group(self, group_id: str, user_id: str) -> bool:
        """Remove a user from a group"""
        if group_id not in self.groups:
            return False
        
        group = self.groups[group_id]
        if user_id in group.members:
            group.members.remove(user_id)
        return True
    
    # Expense Management
    def add_expense(self, description: str, amount: float, paid_by: str, 
                   group_id: Optional[str] = None, category: str = "General") -> Expense:
        """Add a new expense"""
        if paid_by not in self.users:
            raise ValueError("Payer must be a valid user")
        
        if group_id and group_id not in self.groups:
            raise ValueError("Group must be valid")
        
        expense = Expense(
            description=description,
            amount=amount,
            paid_by=paid_by,
            group_id=group_id,
            category=category
        )
        self.expenses[expense.id] = expense
        return expense
    
    def split_expense_equally(self, expense_id: str, user_ids: List[str]) -> bool:
        """Split an expense equally among specified users"""
        if expense_id not in self.expenses:
            return False
        
        expense = self.expenses[expense_id]
        if not all(user_id in self.users for user_id in user_ids):
            return False
        
        split_amount = expense.amount / len(user_ids)
        expense.split_type = SplitType.EQUAL
        expense.splits = [Split(user_id=uid, amount=split_amount) for uid in user_ids]
        return True
    
    def split_expense_exact(self, expense_id: str, splits: Dict[str, float]) -> bool:
        """Split an expense with exact amounts for each user"""
        if expense_id not in self.expenses:
            return False
        
        expense = self.expenses[expense_id]
        if not all(user_id in self.users for user_id in splits.keys()):
            return False
        
        total_splits = sum(splits.values())
        if abs(total_splits - expense.amount) > 0.01:  # Allow for small rounding errors
            raise ValueError(f"Split amounts ({total_splits}) don't match expense amount ({expense.amount})")
        
        expense.split_type = SplitType.EXACT
        expense.splits = [Split(user_id=uid, amount=amount) for uid, amount in splits.items()]
        return True
    
    def split_expense_percentage(self, expense_id: str, percentages: Dict[str, float]) -> bool:
        """Split an expense by percentage"""
        if expense_id not in self.expenses:
            return False
        
        expense = self.expenses[expense_id]
        if not all(user_id in self.users for user_id in percentages.keys()):
            return False
        
        total_percentage = sum(percentages.values())
        if abs(total_percentage - 100.0) > 0.01:
            raise ValueError(f"Percentages must sum to 100%, got {total_percentage}%")
        
        expense.split_type = SplitType.PERCENTAGE
        expense.splits = []
        for uid, percentage in percentages.items():
            amount = (percentage / 100.0) * expense.amount
            expense.splits.append(Split(user_id=uid, amount=amount, percentage=percentage))
        return True
    
    # Balance Calculations
    def calculate_user_balance(self, user_id: str, group_id: Optional[str] = None) -> Dict[str, float]:
        """Calculate how much a user owes or is owed by others"""
        if user_id not in self.users:
            return {}
        
        balances = {}
        
        for expense in self.expenses.values():
            # Filter by group if specified
            if group_id and expense.group_id != group_id:
                continue
            
            # Skip expenses with no splits
            if not expense.splits:
                continue
            
            # Calculate what this user owes for this expense
            user_owes = 0.0
            for split in expense.splits:
                if split.user_id == user_id:
                    user_owes = split.amount
                    break
            
            # If this user paid the expense
            if expense.paid_by == user_id:
                # Others owe this user
                for split in expense.splits:
                    if split.user_id != user_id:
                        other_user = split.user_id
                        if other_user not in balances:
                            balances[other_user] = 0.0
                        balances[other_user] += split.amount
            else:
                # This user owes the person who paid
                if user_owes > 0:
                    payer = expense.paid_by
                    if payer not in balances:
                        balances[payer] = 0.0
                    balances[payer] -= user_owes
        
        return balances
    
    def get_group_balances(self, group_id: str) -> Dict[str, Dict[str, float]]:
        """Get all balances within a group"""
        if group_id not in self.groups:
            return {}
        
        group = self.groups[group_id]
        group_balances = {}
        
        for member_id in group.members:
            group_balances[member_id] = self.calculate_user_balance(member_id, group_id)
        
        return group_balances
    
    def simplify_debts(self, balances: Dict[str, Dict[str, float]]) -> List[Dict]:
        """Simplify debts to minimize number of transactions"""
        # Calculate net balance for each user
        net_balances = {}
        for user_id, user_balances in balances.items():
            net_balances[user_id] = sum(user_balances.values())
        
        # Separate creditors and debtors
        creditors = {uid: amount for uid, amount in net_balances.items() if amount > 0.01}
        debtors = {uid: -amount for uid, amount in net_balances.items() if amount < -0.01}
        
        transactions = []
        
        # Match debtors with creditors
        for debtor_id, debt_amount in debtors.items():
            remaining_debt = debt_amount
            
            for creditor_id, credit_amount in list(creditors.items()):
                if remaining_debt <= 0.01:
                    break
                
                payment = min(remaining_debt, credit_amount)
                
                transactions.append({
                    'from': debtor_id,
                    'to': creditor_id,
                    'amount': round(payment, 2)
                })
                
                remaining_debt -= payment
                creditors[creditor_id] -= payment
                
                if creditors[creditor_id] <= 0.01:
                    del creditors[creditor_id]
        
        return transactions
    
    # Utility Methods
    def get_user_expenses(self, user_id: str) -> List[Expense]:
        """Get all expenses involving a user"""
        user_expenses = []
        for expense in self.expenses.values():
            if expense.paid_by == user_id or any(split.user_id == user_id for split in expense.splits):
                user_expenses.append(expense)
        return sorted(user_expenses, key=lambda x: x.created_at, reverse=True)
    
    def get_group_expenses(self, group_id: str) -> List[Expense]:
        """Get all expenses for a group"""
        group_expenses = [exp for exp in self.expenses.values() if exp.group_id == group_id]
        return sorted(group_expenses, key=lambda x: x.created_at, reverse=True)


# Example usage
if __name__ == "__main__":
    # Create the main application
    app = ExpenseSplitter()
    
    # Create users
    alice = app.create_user("Alice", "alice@example.com")
    bob = app.create_user("Bob", "bob@example.com")
    charlie = app.create_user("Charlie", "charlie@example.com")
    
    print(f"Created users: {alice.name}, {bob.name}, {charlie.name}")
    
    # Create a group
    group = app.create_group("Roommates", alice.id, "Shared apartment expenses")
    app.add_user_to_group(group.id, bob.id)
    app.add_user_to_group(group.id, charlie.id)
    
    print(f"Created group: {group.name} with {len(group.members)} members")
    
    # Add expenses
    expense1 = app.add_expense("Groceries", 120.00, alice.id, group.id, "Food")
    app.split_expense_equally(expense1.id, [alice.id, bob.id, charlie.id])
    
    expense2 = app.add_expense("Electricity Bill", 90.00, bob.id, group.id, "Utilities")
    app.split_expense_equally(expense2.id, [alice.id, bob.id, charlie.id])
    
    expense3 = app.add_expense("Internet", 60.00, charlie.id, group.id, "Utilities")
    app.split_expense_equally(expense3.id, [alice.id, bob.id, charlie.id])
    
    print(f"Added {len(app.expenses)} expenses")
    
    # Calculate balances
    alice_balances = app.calculate_user_balance(alice.id, group.id)
    print(f"\nAlice's balances: {alice_balances}")
    
    # Get group balances and simplify
    group_balances = app.get_group_balances(group.id)
    simplified_transactions = app.simplify_debts(group_balances)
    
    print(f"\nSimplified transactions:")
    for transaction in simplified_transactions:
        from_user = app.get_user(transaction['from']).name
        to_user = app.get_user(transaction['to']).name
        amount = transaction['amount']
        print(f"{from_user} owes {to_user}: ${amount:.2f}")