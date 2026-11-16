import psycopg2
from psycopg2.extras import RealDictCursor
from datetime import datetime
from typing import Dict, List, Optional, Tuple
from enum import Enum

class SplitType(Enum):
    EQUAL = "equal"
    EXACT = "exact"
    PERCENTAGE = "percentage"

class DatabaseManager:
    def __init__(self, db_config):
        self.db_config = db_config
        
    def get_connection(self):
        return psycopg2.connect(**self.db_config)
    
    def execute_query(self, query, params=None, fetch=False):
        conn = self.get_connection()
        try:
            with conn.cursor(cursor_factory=RealDictCursor) as cursor:
                cursor.execute(query, params or ())
                if fetch:
                    return cursor.fetchall()
                conn.commit()
                return cursor.rowcount
        finally:
            conn.close()
    
    def execute_one(self, query, params=None):
        conn = self.get_connection()
        try:
            with conn.cursor(cursor_factory=RealDictCursor) as cursor:
                cursor.execute(query, params or ())
                result = cursor.fetchone()
                conn.commit()
                return result
        finally:
            conn.close()

class UserModel:
    def __init__(self, db_manager: DatabaseManager):
        self.db = db_manager
    
    def create(self, name: str, email: str = None, phone: str = None) -> Dict:
        # Validate input
        if not name or not name.strip():
            raise ValueError("User name cannot be empty")
        
        name = name.strip()
        email = email.strip() if email else None
        phone = phone.strip() if phone else None
        
        # Check for duplicate email if provided
        if email:
            existing_email = self.get_by_email(email)
            if existing_email:
                raise ValueError(f"User with email '{email}' already exists")
        
        try:
            query = """
                INSERT INTO users (name, email, phone)
                VALUES (%s, %s, %s)
                RETURNING *
            """
            result = self.db.execute_one(query, (name, email, phone))
            return result
        except psycopg2.IntegrityError as e:
            if "users_email_key" in str(e):
                raise ValueError(f"Email '{email}' is already in use")
            raise ValueError(f"Database constraint violation: {str(e)}")
        except Exception as e:
            raise ValueError(f"Failed to create user: {str(e)}")
    
    def get_by_id(self, user_id: str) -> Optional[Dict]:
        query = "SELECT * FROM users WHERE id = %s AND is_active = TRUE"
        return self.db.execute_one(query, (user_id,))
    
    def get_by_name(self, name: str) -> Optional[Dict]:
        query = "SELECT * FROM users WHERE LOWER(name) = LOWER(%s) AND is_active = TRUE"
        return self.db.execute_one(query, (name.strip(),))
    
    def get_by_email(self, email: str) -> Optional[Dict]:
        query = "SELECT * FROM users WHERE LOWER(email) = LOWER(%s) AND is_active = TRUE"
        return self.db.execute_one(query, (email.strip(),))
    
    def get_all(self) -> List[Dict]:
        query = "SELECT * FROM users WHERE is_active = TRUE ORDER BY name"
        return self.db.execute_query(query, fetch=True)
    
    def update(self, user_id: str, name: str = None, email: str = None, phone: str = None) -> Optional[Dict]:
        # Build dynamic update query
        updates = []
        params = []
        
        if name and name.strip():
            updates.append("name = %s")
            params.append(name.strip())
        
        if email is not None:
            if email.strip():
                # Check for duplicate email
                existing = self.get_by_email(email.strip())
                if existing and existing['id'] != user_id:
                    raise ValueError(f"Email '{email}' is already in use")
                updates.append("email = %s")
                params.append(email.strip())
            else:
                updates.append("email = NULL")
        
        if phone is not None:
            if phone.strip():
                updates.append("phone = %s")
                params.append(phone.strip())
            else:
                updates.append("phone = NULL")
        
        if not updates:
            return self.get_by_id(user_id)
        
        params.append(user_id)
        query = f"""
            UPDATE users 
            SET {', '.join(updates)}, updated_at = CURRENT_TIMESTAMP
            WHERE id = %s AND is_active = TRUE
            RETURNING *
        """
        
        try:
            return self.db.execute_one(query, params)
        except psycopg2.IntegrityError as e:
            if "users_email_key" in str(e):
                raise ValueError(f"Email is already in use")
            raise ValueError(f"Database constraint violation: {str(e)}")
    
    def deactivate(self, user_id: str) -> bool:
        query = """
            UPDATE users 
            SET is_active = FALSE, updated_at = CURRENT_TIMESTAMP
            WHERE id = %s AND is_active = TRUE
        """
        rows = self.db.execute_query(query, (user_id,))
        return rows > 0

class GroupModel:
    def __init__(self, db_manager: DatabaseManager):
        self.db = db_manager
    
    def create(self, name: str, created_by: str, description: str = None) -> Dict:
        query = """
            INSERT INTO groups (name, description, created_by)
            VALUES (%s, %s, %s)
            RETURNING *
        """
        result = self.db.execute_one(query, (name, description, created_by))
        return result
    
    def get_by_id(self, group_id: str) -> Optional[Dict]:
        query = "SELECT * FROM groups WHERE id = %s AND is_active = TRUE"
        return self.db.execute_one(query, (group_id,))
    
    def get_user_groups(self, user_id: str) -> List[Dict]:
        query = """
            SELECT g.* FROM groups g
            JOIN group_memberships gm ON g.id = gm.group_id
            WHERE gm.user_id = %s AND g.is_active = TRUE AND gm.is_active = TRUE
            ORDER BY g.created_at DESC
        """
        return self.db.execute_query(query, (user_id,), fetch=True)
    
    def add_member(self, group_id: str, user_id: str) -> bool:
        query = """
            INSERT INTO group_memberships (group_id, user_id)
            VALUES (%s, %s)
            ON CONFLICT (group_id, user_id) DO UPDATE SET is_active = TRUE
        """
        rows = self.db.execute_query(query, (group_id, user_id))
        return rows > 0
    
    def get_members(self, group_id: str) -> List[Dict]:
        query = """
            SELECT u.* FROM users u
            JOIN group_memberships gm ON u.id = gm.user_id
            WHERE gm.group_id = %s AND gm.is_active = TRUE AND u.is_active = TRUE
            ORDER BY u.name
        """
        return self.db.execute_query(query, (group_id,), fetch=True)

class ExpenseModel:
    def __init__(self, db_manager: DatabaseManager):
        self.db = db_manager
    
    def create(self, description: str, amount: float, paid_by: str, 
               group_id: str = None, category: str = "general", 
               notes: str = None, expense_date: datetime = None) -> Dict:
        query = """
            INSERT INTO expenses (description, amount, paid_by, group_id, 
                                category, notes, expense_date)
            VALUES (%s, %s, %s, %s, %s, %s, %s)
            RETURNING *
        """
        result = self.db.execute_one(
            query, 
            (description, amount, paid_by, group_id, category, notes, 
             expense_date or datetime.now().date())
        )
        return result
    
    def add_splits(self, expense_id: str, splits: List[Tuple[str, float, float]]):
        conn = self.db.get_connection()
        try:
            with conn.cursor() as cursor:
                for user_id, amount, percentage in splits:
                    cursor.execute("""
                        INSERT INTO expense_splits (expense_id, user_id, amount, percentage)
                        VALUES (%s, %s, %s, %s)
                    """, (expense_id, user_id, amount, percentage))
                conn.commit()
        finally:
            conn.close()
    
    def get_user_expenses(self, user_id: str) -> List[Dict]:
        # First get the expenses
        query = """
            SELECT DISTINCT e.*
            FROM expenses e
            LEFT JOIN expense_splits es ON e.id = es.expense_id
            WHERE (e.paid_by = %s OR es.user_id = %s) 
                AND e.is_deleted = FALSE
            ORDER BY e.created_at DESC
        """
        expenses = self.db.execute_query(query, (user_id, user_id), fetch=True)
        
        # Then get splits for each expense
        for expense in expenses:
            splits_query = """
                SELECT user_id, amount, percentage
                FROM expense_splits
                WHERE expense_id = %s
                ORDER BY user_id
            """
            splits = self.db.execute_query(splits_query, (expense['id'],), fetch=True)
            expense['splits'] = splits
        
        return expenses
    
    def get_group_expenses(self, group_id: str) -> List[Dict]:
        query = """
            SELECT e.*, 
                   array_agg(json_build_object(
                       'user_id', es.user_id, 
                       'amount', es.amount,
                       'percentage', es.percentage
                   )) as splits
            FROM expenses e
            LEFT JOIN expense_splits es ON e.id = es.expense_id
            WHERE e.group_id = %s AND e.is_deleted = FALSE
            GROUP BY e.id
            ORDER BY e.created_at DESC
        """
        return self.db.execute_query(query, (group_id,), fetch=True)

class BalanceModel:
    def __init__(self, db_manager: DatabaseManager):
        self.db = db_manager
    
    def get_user_balances(self, user_id: str, group_id: str = None) -> Dict[str, float]:
        if group_id:
            query = """
                SELECT net_balance.other_user_id, SUM(net_balance.amount) as balance
                FROM (
                    SELECT es.user_id as other_user_id, -es.amount as amount
                    FROM expenses e
                    JOIN expense_splits es ON e.id = es.expense_id
                    WHERE e.paid_by = %s AND es.user_id != %s 
                        AND e.group_id = %s AND e.is_deleted = FALSE
                    
                    UNION ALL
                    
                    SELECT e.paid_by as other_user_id, es.amount as amount
                    FROM expenses e
                    JOIN expense_splits es ON e.id = es.expense_id
                    WHERE es.user_id = %s AND e.paid_by != %s 
                        AND e.group_id = %s AND e.is_deleted = FALSE
                ) as net_balance
                GROUP BY net_balance.other_user_id
                HAVING SUM(net_balance.amount) != 0
            """
            params = (user_id, user_id, group_id, user_id, user_id, group_id)
        else:
            query = """
                SELECT net_balance.other_user_id, SUM(net_balance.amount) as balance
                FROM (
                    SELECT es.user_id as other_user_id, -es.amount as amount
                    FROM expenses e
                    JOIN expense_splits es ON e.id = es.expense_id
                    WHERE e.paid_by = %s AND es.user_id != %s AND e.is_deleted = FALSE
                    
                    UNION ALL
                    
                    SELECT e.paid_by as other_user_id, es.amount as amount
                    FROM expenses e
                    JOIN expense_splits es ON e.id = es.expense_id
                    WHERE es.user_id = %s AND e.paid_by != %s AND e.is_deleted = FALSE
                ) as net_balance
                GROUP BY net_balance.other_user_id
                HAVING SUM(net_balance.amount) != 0
            """
            params = (user_id, user_id, user_id, user_id)
        
        results = self.db.execute_query(query, params, fetch=True)
        return {row['other_user_id']: float(row['balance']) for row in results}

class SettlementModel:
    def __init__(self, db_manager: DatabaseManager):
        self.db = db_manager
    
    def create(self, from_user_id: str, to_user_id: str, amount: float,
               group_id: str = None, description: str = None) -> Dict:
        query = """
            INSERT INTO settlements (from_user_id, to_user_id, amount, group_id, description)
            VALUES (%s, %s, %s, %s, %s)
            RETURNING *
        """
        return self.db.execute_one(query, (from_user_id, to_user_id, amount, group_id, description))
    