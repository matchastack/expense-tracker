import streamlit as st
import pandas as pd
from datetime import datetime
import plotly.express as px
import plotly.graph_objects as go
from models import (
    DatabaseManager, UserModel, GroupModel, ExpenseModel, 
    BalanceModel, SettlementModel, SplitType
)
from db import DEFAULT_DB_CONFIG, check_db_exists
import os

st.set_page_config(
    page_title="SplitWiser",
    page_icon="💰",
    layout="wide",
    initial_sidebar_state="expanded"
)

@st.cache_resource
def init_database():
    """Initialize database connection and models."""
    if not check_db_exists():
        st.error("Database not found! Please run the database initialization script first.")
        st.stop()
    
    db_manager = DatabaseManager(DEFAULT_DB_CONFIG)
    return {
        'users': UserModel(db_manager),
        'groups': GroupModel(db_manager),
        'expenses': ExpenseModel(db_manager),
        'balances': BalanceModel(db_manager),
        'settlements': SettlementModel(db_manager)
    }

models = init_database()

if 'current_user' not in st.session_state:
    st.session_state.current_user = None
if 'selected_group' not in st.session_state:
    st.session_state.selected_group = None

st.markdown("""
<style>
    .main-header {
        font-size: 2.5rem;
        font-weight: bold;
        color: #1f77b4;
        text-align: center;
        margin-bottom: 2rem;
    }
    .balance-positive {
        color: #28a745;
        font-weight: bold;
    }
    .balance-negative {
        color: #dc3545;
        font-weight: bold;
    }
</style>
""", unsafe_allow_html=True)

# Sidebar
with st.sidebar:
    st.title("🏠 Navigation")
    
    st.subheader("👤 Current User")
    
    users = models['users'].get_all()
    user_names = [user['name'] for user in users]
    
    if user_names:
        selected_user_name = st.selectbox("Select User", ["None"] + user_names)
        if selected_user_name != "None":
            st.session_state.current_user = models['users'].get_by_name(selected_user_name)
        else:
            st.session_state.current_user = None
    
    with st.expander("➕ Create New User"):
        new_user_name = st.text_input("Name")
        new_user_email = st.text_input("Email (optional)")
        new_user_phone = st.text_input("Phone (optional)")
        if st.button("Create User"):
            if new_user_name:
                try:
                    user = models['users'].create(new_user_name, new_user_email, new_user_phone)
                    st.success(f"Created user: {user['name']}")
                    st.rerun()
                except Exception as e:
                    st.error(str(e))
    
    st.subheader("👥 Groups")
    
    if st.session_state.current_user:
        user_groups = models['groups'].get_user_groups(st.session_state.current_user['id'])
        
        if user_groups:
            group_names = [group['name'] for group in user_groups]
            selected_group_name = st.selectbox("Select Group", ["None"] + group_names)
            
            if selected_group_name != "None":
                st.session_state.selected_group = next(
                    group for group in user_groups if group['name'] == selected_group_name
                )
            else:
                st.session_state.selected_group = None
        else:
            st.info("No groups found. Create a group to get started!")

# Main content
st.markdown('<h1 class="main-header">💰 SplitWiser</h1>', unsafe_allow_html=True)

if not st.session_state.current_user:
    st.warning("👋 Please select or create a user to get started!")
    st.stop()

current_user = st.session_state.current_user
st.success(f"Welcome back, {current_user['name']}! 👋")

tab1, tab2, tab3, tab4, tab5 = st.tabs(["📊 Dashboard", "💸 Add Expense", "👥 Manage Groups", "📈 Analytics", "⚖️ Settle Up"])

# Dashboard Tab
with tab1:
    col1, col2, col3 = st.columns(3)
    
    user_expenses = models['expenses'].get_user_expenses(current_user['id'])
    total_expenses = len(user_expenses)
    total_paid = sum(float(exp['amount']) for exp in user_expenses if exp['paid_by'] == current_user['id'])
    
    with col1:
        st.metric("Total Expenses", total_expenses)
    with col2:
        st.metric("Total Paid", f"${total_paid:.2f}")
    with col3:
        if st.session_state.selected_group:
            balances = models['balances'].get_user_balances(
                current_user['id'], 
                st.session_state.selected_group['id']
            )
            net_balance = sum(balances.values())
            st.metric("Net Balance", f"${net_balance:.2f}", 
                     delta_color="normal" if net_balance >= 0 else "inverse")
    
    st.subheader("📋 Recent Expenses")
    if user_expenses:
        expenses_data = []
        for exp in user_expenses[:10]:
            payer = models['users'].get_by_id(exp['paid_by'])
            expenses_data.append({
                "Date": exp['created_at'].strftime("%Y-%m-%d"),
                "Description": exp['description'],
                "Amount": f"${float(exp['amount']):.2f}",
                "Paid By": payer['name'] if payer else "Unknown",
                "Category": exp['category'],
                "Split Type": exp['split_type']
            })
        
        df = pd.DataFrame(expenses_data)
        st.dataframe(df, use_container_width=True)
    else:
        st.info("No expenses found. Add your first expense!")
    
    if st.session_state.selected_group:
        st.subheader("💰 Current Balances")
        balances = models['balances'].get_user_balances(
            current_user['id'], 
            st.session_state.selected_group['id']
        )
        
        if balances:
            balance_data = []
            for user_id, amount in balances.items():
                user = models['users'].get_by_id(user_id)
                if user:
                    if amount > 0:
                        balance_data.append({
                            "Person": user['name'], 
                            "Status": f"Owes you ${amount:.2f}", 
                            "Type": "positive"
                        })
                    elif amount < 0:
                        balance_data.append({
                            "Person": user['name'], 
                            "Status": f"You owe ${abs(amount):.2f}", 
                            "Type": "negative"
                        })
            
            for item in balance_data:
                if item["Type"] == "positive":
                    st.markdown(f'<p class="balance-positive">✅ {item["Person"]} {item["Status"]}</p>', 
                              unsafe_allow_html=True)
                else:
                    st.markdown(f'<p class="balance-negative">❌ {item["Person"]} - {item["Status"]}</p>', 
                              unsafe_allow_html=True)
        else:
            st.success("🎉 All settled up!")

# Add Expense Tab
with tab2:
    st.header("💸 Add New Expense")
    
    with st.form("add_expense_form"):
        col1, col2 = st.columns(2)
        
        with col1:
            description = st.text_input("Description*", placeholder="e.g., Dinner at restaurant")
            amount = st.number_input("Amount*", min_value=0.01, step=0.01, format="%.2f")
            category = st.selectbox("Category", [
                "general", "food", "utilities", "rent", "transportation",
                "entertainment", "shopping", "travel", "healthcare", "other"
            ])
        
        with col2:
            group_members = []
            if st.session_state.selected_group:
                group_members_data = models['groups'].get_members(st.session_state.selected_group['id'])
                group_members = [(m['id'], m['name']) for m in group_members_data]
            
            if group_members:
                paid_by_options = {name: uid for uid, name in group_members}
                paid_by_name = st.selectbox("Paid by*", list(paid_by_options.keys()))
                paid_by_id = paid_by_options[paid_by_name]
            else:
                paid_by_id = current_user['id']
                st.info(f"Paid by: {current_user['name']}")
            
            split_type = st.selectbox("Split Type", ["Equal", "Exact", "Percentage"])
            
            if st.session_state.selected_group:
                st.info(f"Adding to group: {st.session_state.selected_group['name']}")
        
        st.subheader("Split Configuration")
        
        splits_data = []
        
        if st.session_state.selected_group and group_members:
            if split_type == "Equal":
                selected_members = st.multiselect(
                    "Split between", 
                    [name for _, name in group_members], 
                    default=[name for _, name in group_members]
                )
                
                if selected_members:
                    split_amount = amount / len(selected_members)
                    member_lookup = {name: uid for uid, name in group_members}
                    for member_name in selected_members:
                        splits_data.append((member_lookup[member_name], split_amount, 0))
            
            elif split_type == "Exact":
                st.write("Enter exact amounts for each person:")
                exact_amounts = {}
                remaining = amount
                
                for uid, member_name in group_members:
                    member_amount = st.number_input(
                        f"{member_name}", 
                        min_value=0.0, 
                        max_value=float(remaining), 
                        step=0.01, 
                        key=f"exact_{uid}"
                    )
                    if member_amount > 0:
                        exact_amounts[uid] = member_amount
                        splits_data.append((uid, member_amount, 0))
                    remaining -= member_amount
                
                if remaining < -0.01:
                    st.error(f"Total splits exceed expense amount by ${abs(remaining):.2f}")
                elif remaining > 0.01:
                    st.warning(f"Remaining amount to split: ${remaining:.2f}")
            
            elif split_type == "Percentage":
                st.write("Enter percentages for each person:")
                percentages = {}
                total_percentage = 0
                
                for uid, member_name in group_members:
                    member_percentage = st.number_input(
                        f"{member_name} (%)", 
                        min_value=0.0, 
                        max_value=100.0, 
                        step=0.1, 
                        key=f"percentage_{uid}"
                    )
                    if member_percentage > 0:
                        member_amount = (member_percentage / 100.0) * amount
                        percentages[uid] = member_percentage
                        splits_data.append((uid, member_amount, member_percentage))
                    total_percentage += member_percentage
                
                if abs(total_percentage - 100) > 0.1:
                    st.error(f"Percentages must sum to 100%. Current total: {total_percentage}%")
        
        submitted = st.form_submit_button("💾 Add Expense", use_container_width=True)
        
        if submitted:
            if not description or amount <= 0:
                st.error("Please fill in all required fields!")
            elif not splits_data:
                st.error("Please configure the expense split!")
            else:
                try:
                    expense = models['expenses'].create(
                        description, 
                        amount, 
                        paid_by_id,
                        st.session_state.selected_group['id'] if st.session_state.selected_group else None,
                        category
                    )
                    
                    models['expenses'].add_splits(expense['id'], splits_data)
                    
                    st.success(f"✅ Added expense: {description} (${amount:.2f})")
                    st.rerun()
                    
                except Exception as e:
                    st.error(f"Error: {str(e)}")

# Manage Groups Tab
with tab3:
    st.header("👥 Manage Groups")
    
    with st.expander("➕ Create New Group"):
        with st.form("create_group_form"):
            group_name = st.text_input("Group Name*")
            group_description = st.text_area("Description")
            
            if st.form_submit_button("Create Group"):
                if group_name:
                    try:
                        group = models['groups'].create(
                            group_name, 
                            current_user['id'], 
                            group_description
                        )
                        st.success(f"✅ Created group: {group['name']}")
                        st.rerun()
                    except Exception as e:
                        st.error(str(e))
                else:
                    st.error("Group name is required!")
    
    st.subheader("Your Groups")
    user_groups = models['groups'].get_user_groups(current_user['id'])
    
    if user_groups:
        for group in user_groups:
            with st.expander(f"📁 {group['name']}"):
                col1, col2 = st.columns(2)
                
                with col1:
                    st.write(f"**Description:** {group['description'] or 'No description'}")
                    st.write(f"**Created:** {group['created_at'].strftime('%Y-%m-%d')}")
                    
                    members = models['groups'].get_members(group['id'])
                    st.write(f"**Members:** {len(members)}")
                
                with col2:
                    st.write("**Group Members:**")
                    for member in members:
                        is_creator = member['id'] == group['created_by']
                        st.write(f"• {member['name']} {'👑' if is_creator else ''}")
                
                if group['created_by'] == current_user['id']:
                    all_users = models['users'].get_all()
                    member_ids = [m['id'] for m in members]
                    available_users = [u for u in all_users if u['id'] not in member_ids]
                    
                    if available_users:
                        user_options = {u['name']: u['id'] for u in available_users}
                        new_member_name = st.selectbox(
                            f"Add member to {group['name']}", 
                            ["Select user..."] + list(user_options.keys()),
                            key=f"add_member_{group['id']}"
                        )
                        
                        if st.button(f"Add Member", key=f"btn_add_{group['id']}"):
                            if new_member_name != "Select user...":
                                models['groups'].add_member(
                                    group['id'], 
                                    user_options[new_member_name]
                                )
                                st.success(f"Added {new_member_name} to {group['name']}")
                                st.rerun()
                                