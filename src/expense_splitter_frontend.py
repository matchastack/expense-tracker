import streamlit as st
import pandas as pd
from datetime import datetime, date
from typing import Dict, List
import plotly.express as px
import plotly.graph_objects as go

# Import your existing classes (assuming they're in main.py)
from main import ExpenseSplitter, SplitType, User, Group, Expense

# Configure Streamlit page
st.set_page_config(
    page_title="SplitWiser",
    page_icon="💰",
    layout="wide",
    initial_sidebar_state="expanded"
)

# Initialize session state
if 'app' not in st.session_state:
    st.session_state.app = ExpenseSplitter()
if 'current_user' not in st.session_state:
    st.session_state.current_user = None
if 'selected_group' not in st.session_state:
    st.session_state.selected_group = None

app = st.session_state.app

# Custom CSS for better styling
st.markdown("""
<style>
    .main-header {
        font-size: 2.5rem;
        font-weight: bold;
        color: #1f77b4;
        text-align: center;
        margin-bottom: 2rem;
    }
    .metric-card {
        background: linear-gradient(90deg, #667eea 0%, #764ba2 100%);
        padding: 1rem;
        border-radius: 10px;
        color: white;
    }
    .balance-positive {
        color: #28a745;
        font-weight: bold;
    }
    .balance-negative {
        color: #dc3545;
        font-weight: bold;
    }
    .sidebar-section {
        margin-bottom: 2rem;
    }
</style>
""", unsafe_allow_html=True)

# Sidebar for navigation and user management
with st.sidebar:
    st.markdown('<div class="sidebar-section">', unsafe_allow_html=True)
    st.title("🏠 Navigation")
    
    # User selection/creation
    st.subheader("👤 Current User")
    
    user_names = [user.name for user in app.users.values()]
    if user_names:
        selected_user_name = st.selectbox("Select User", ["None"] + user_names)
        if selected_user_name != "None":
            st.session_state.current_user = app.get_user_by_name(selected_user_name)
        else:
            st.session_state.current_user = None
    
    # Quick user creation
    with st.expander("➕ Create New User"):
        new_user_name = st.text_input("Name")
        new_user_email = st.text_input("Email (optional)")
        if st.button("Create User"):
            if new_user_name:
                try:
                    user = app.create_user(new_user_name, new_user_email)
                    st.success(f"Created user: {user.name}")
                    st.rerun()
                except ValueError as e:
                    st.error(str(e))
    
    st.markdown('</div>', unsafe_allow_html=True)
    
    # Group selection
    st.markdown('<div class="sidebar-section">', unsafe_allow_html=True)
    st.subheader("👥 Groups")
    
    if st.session_state.current_user:
        user_groups = [group for group in app.groups.values() 
                      if st.session_state.current_user.id in group.members]
        
        if user_groups:
            group_names = [group.name for group in user_groups]
            selected_group_name = st.selectbox("Select Group", ["None"] + group_names)
            
            if selected_group_name != "None":
                st.session_state.selected_group = next(
                    group for group in user_groups if group.name == selected_group_name
                )
            else:
                st.session_state.selected_group = None
        else:
            st.info("No groups found. Create a group to get started!")
    
    st.markdown('</div>', unsafe_allow_html=True)

# Main content area
st.markdown('<h1 class="main-header">💰 SplitWise Clone</h1>', unsafe_allow_html=True)

# Check if user is logged in
if not st.session_state.current_user:
    st.warning("👋 Please select or create a user to get started!")
    st.stop()

current_user = st.session_state.current_user
st.success(f"Welcome back, {current_user.name}! 👋")

# Main navigation tabs
tab1, tab2, tab3, tab4, tab5 = st.tabs(["📊 Dashboard", "💸 Add Expense", "👥 Manage Groups", "📈 Analytics", "⚖️ Settle Up"])

# Tab 1: Dashboard
with tab1:
    col1, col2, col3 = st.columns(3)
    
    # User statistics
    user_expenses = app.get_user_expenses(current_user.id)
    total_expenses = len(user_expenses)
    total_paid = sum(exp.amount for exp in user_expenses if exp.paid_by == current_user.id)
    
    with col1:
        st.metric("Total Expenses", total_expenses)
    with col2:
        st.metric("Total Paid", f"${total_paid:.2f}")
    with col3:
        if st.session_state.selected_group:
            balances = app.calculate_user_balance(current_user.id, st.session_state.selected_group.id)
            net_balance = sum(balances.values())
            st.metric("Net Balance", f"${net_balance:.2f}", 
                     delta_color="normal" if net_balance >= 0 else "inverse")
    
    # Recent expenses
    st.subheader("📋 Recent Expenses")
    if user_expenses:
        expenses_data = []
        for exp in user_expenses[:10]:  # Show last 10 expenses
            expenses_data.append({
                "Date": exp.created_at.strftime("%Y-%m-%d"),
                "Description": exp.description,
                "Amount": f"${exp.amount:.2f}",
                "Paid By": app.get_user(exp.paid_by).name,
                "Category": exp.category,
                "Split Type": exp.split_type.value
            })
        
        df = pd.DataFrame(expenses_data)
        st.dataframe(df, use_container_width=True)
    else:
        st.info("No expenses found. Add your first expense!")
    
    # Current balances
    if st.session_state.selected_group:
        st.subheader("💰 Current Balances")
        balances = app.calculate_user_balance(current_user.id, st.session_state.selected_group.id)
        
        if balances:
            balance_data = []
            for user_id, amount in balances.items():
                user = app.get_user(user_id)
                if amount > 0:
                    balance_data.append({"Person": user.name, "Status": f"Owes you ${amount:.2f}", "Type": "positive"})
                elif amount < 0:
                    balance_data.append({"Person": user.name, "Status": f"You owe ${abs(amount):.2f}", "Type": "negative"})
            
            for item in balance_data:
                if item["Type"] == "positive":
                    st.markdown(f'<p class="balance-positive">✅ {item["Person"]} {item["Status"]}</p>', unsafe_allow_html=True)
                else:
                    st.markdown(f'<p class="balance-negative">❌ {item["Person"]} - {item["Status"]}</p>', unsafe_allow_html=True)
        else:
            st.success("🎉 All settled up!")

# Tab 2: Add Expense
with tab2:
    st.header("💸 Add New Expense")
    
    with st.form("add_expense_form"):
        col1, col2 = st.columns(2)
        
        with col1:
            description = st.text_input("Description*", placeholder="e.g., Dinner at restaurant")
            amount = st.number_input("Amount*", min_value=0.01, step=0.01, format="%.2f")
            category = st.selectbox("Category", [
                "General", "Food", "Utilities", "Rent", "Transportation",
                "Entertainment", "Shopping", "Travel", "Healthcare", "Other"
            ])
        
        with col2:
            # Paid by selection
            group_members = []
            if st.session_state.selected_group:
                group_members = [app.get_user(uid).name for uid in st.session_state.selected_group.members]
            
            paid_by_name = st.selectbox("Paid by*", group_members if group_members else [current_user.name])
            
            # Split type
            split_type = st.selectbox("Split Type", ["Equal", "Exact", "Percentage"])
            
            # Group selection for expense
            if st.session_state.selected_group:
                st.info(f"Adding to group: {st.session_state.selected_group.name}")
        
        # Split configuration
        st.subheader("Split Configuration")
        
        if st.session_state.selected_group and group_members:
            if split_type == "Equal":
                selected_members = st.multiselect(
                    "Split between", 
                    group_members, 
                    default=group_members
                )
            
            elif split_type == "Exact":
                st.write("Enter exact amounts for each person:")
                exact_amounts = {}
                remaining = amount
                
                for member in group_members:
                    member_amount = st.number_input(
                        f"{member}", 
                        min_value=0.0, 
                        max_value=float(remaining), 
                        step=0.01, 
                        key=f"exact_{member}"
                    )
                    exact_amounts[member] = member_amount
                    remaining -= member_amount
                
                if remaining < -0.01:
                    st.error(f"Total splits exceed expense amount by ${abs(remaining):.2f}")
                elif remaining > 0.01:
                    st.warning(f"Remaining amount to split: ${remaining:.2f}")
            
            elif split_type == "Percentage":
                st.write("Enter percentages for each person:")
                percentages = {}
                total_percentage = 0
                
                for member in group_members:
                    member_percentage = st.number_input(
                        f"{member} (%)", 
                        min_value=0.0, 
                        max_value=100.0, 
                        step=0.1, 
                        key=f"percentage_{member}"
                    )
                    percentages[member] = member_percentage
                    total_percentage += member_percentage
                
                if abs(total_percentage - 100) > 0.1:
                    st.error(f"Percentages must sum to 100%. Current total: {total_percentage}%")
        
        submitted = st.form_submit_button("💾 Add Expense", use_container_width=True)
        
        if submitted:
            if not description or amount <= 0:
                st.error("Please fill in all required fields!")
            else:
                try:
                    # Get paid_by user ID
                    paid_by_user = app.get_user_by_name(paid_by_name)
                    
                    # Create expense
                    expense = app.add_expense(
                        description, 
                        amount, 
                        paid_by_user.id,
                        st.session_state.selected_group.id if st.session_state.selected_group else None,
                        category
                    )
                    
                    # Apply split
                    if split_type == "Equal" and st.session_state.selected_group:
                        member_ids = [app.get_user_by_name(name).id for name in selected_members]
                        app.split_expense_equally(expense.id, member_ids)
                    
                    elif split_type == "Exact" and st.session_state.selected_group:
                        exact_splits = {app.get_user_by_name(name).id: amount 
                                      for name, amount in exact_amounts.items() if amount > 0}
                        app.split_expense_exact(expense.id, exact_splits)
                    
                    elif split_type == "Percentage" and st.session_state.selected_group:
                        percentage_splits = {app.get_user_by_name(name).id: percentage 
                                           for name, percentage in percentages.items() if percentage > 0}
                        app.split_expense_percentage(expense.id, percentage_splits)
                    
                    st.success(f"✅ Added expense: {description} (${amount:.2f})")
                    st.rerun()
                    
                except ValueError as e:
                    st.error(f"Error: {str(e)}")

# Tab 3: Manage Groups
with tab3:
    st.header("👥 Manage Groups")
    
    # Create new group
    with st.expander("➕ Create New Group"):
        with st.form("create_group_form"):
            group_name = st.text_input("Group Name*")
            group_description = st.text_area("Description")
            
            if st.form_submit_button("Create Group"):
                if group_name:
                    try:
                        group = app.create_group(group_name, current_user.id, group_description)
                        st.success(f"✅ Created group: {group.name}")
                        st.rerun()
                    except ValueError as e:
                        st.error(str(e))
                else:
                    st.error("Group name is required!")
    
    # Display existing groups
    st.subheader("Your Groups")
    user_groups = [group for group in app.groups.values() 
                   if current_user.id in group.members]
    
    if user_groups:
        for group in user_groups:
            with st.expander(f"📁 {group.name}"):
                col1, col2 = st.columns(2)
                
                with col1:
                    st.write(f"**Description:** {group.description or 'No description'}")
                    st.write(f"**Created:** {group.created_at.strftime('%Y-%m-%d')}")
                    st.write(f"**Members:** {len(group.members)}")
                
                with col2:
                    st.write("**Group Members:**")
                    for member_id in group.members:
                        member = app.get_user(member_id)
                        is_creator = member_id == group.created_by
                        st.write(f"• {member.name} {'👑' if is_creator else ''}")
                
                # Add member to group
                if group.created_by == current_user.id:  # Only creator can add members
                    available_users = [user.name for user in app.users.values() 
                                     if user.id not in group.members]
                    
                    if available_users:
                        new_member = st.selectbox(f"Add member to {group.name}", 
                                                ["Select user..."] + available_users,
                                                key=f"add_member_{group.id}")
                        
                        if st.button(f"Add Member", key=f"btn_add_{group.id}"):
                            if new_member != "Select user...":
                                new_member_user = app.get_user_by_name(new_member)
                                app.add_user_to_group(group.id, new_member_user.id)
                                st.success(f"Added {new_member} to {group.name}")
                                st.rerun()
    else:
        st.info("You're not a member of any groups yet. Create one to get started!")

# Tab 4: Analytics
with tab4:
    st.header("📈 Analytics")
    
    if st.session_state.selected_group:
        group = st.session_state.selected_group
        group_expenses = app.get_group_expenses(group.id)
        
        if group_expenses:
            # Expense breakdown by category
            col1, col2 = st.columns(2)
            
            with col1:
                st.subheader("💰 Expenses by Category")
                category_data = {}
                for expense in group_expenses:
                    category = expense.category
                    if category not in category_data:
                        category_data[category] = 0
                    category_data[category] += expense.amount
                
                fig_pie = px.pie(
                    values=list(category_data.values()),
                    names=list(category_data.keys()),
                    title="Expense Distribution by Category"
                )
                st.plotly_chart(fig_pie, use_container_width=True)
            
            with col2:
                st.subheader("📊 Expenses by Member")
                member_data = {}
                for expense in group_expenses:
                    payer = app.get_user(expense.paid_by).name
                    if payer not in member_data:
                        member_data[payer] = 0
                    member_data[payer] += expense.amount
                
                fig_bar = px.bar(
                    x=list(member_data.keys()),
                    y=list(member_data.values()),
                    title="Total Paid by Each Member"
                )
                fig_bar.update_layout(xaxis_title="Member", yaxis_title="Amount ($)")
                st.plotly_chart(fig_bar, use_container_width=True)
            
            # Expense timeline
            st.subheader("📅 Expense Timeline")
            timeline_data = []
            for expense in sorted(group_expenses, key=lambda x: x.created_at):
                timeline_data.append({
                    "Date": expense.created_at.strftime("%Y-%m-%d"),
                    "Amount": expense.amount,
                    "Description": expense.description
                })
            
            if timeline_data:
                df_timeline = pd.DataFrame(timeline_data)
                fig_timeline = px.line(
                    df_timeline, 
                    x="Date", 
                    y="Amount",
                    title="Expense Timeline",
                    hover_data=["Description"]
                )
                st.plotly_chart(fig_timeline, use_container_width=True)
        
        else:
            st.info("No expenses found for this group yet!")
    
    else:
        st.info("Select a group to view analytics!")

# Tab 5: Settle Up
with tab5:
    st.header("⚖️ Settle Up")
    
    if st.session_state.selected_group:
        group = st.session_state.selected_group
        
        # Show simplified transactions
        st.subheader("💸 Suggested Settlements")
        group_balances = app.get_group_balances(group.id)
        simplified_transactions = app.simplify_debts(group_balances)
        
        if simplified_transactions:
            for i, transaction in enumerate(simplified_transactions):
                from_user = app.get_user(transaction['from'])
                to_user = app.get_user(transaction['to'])
                amount = transaction['amount']
                
                col1, col2 = st.columns([3, 1])
                with col1:
                    st.write(f"💰 **{from_user.name}** should pay **{to_user.name}**: **${amount:.2f}**")
                
                with col2:
                    if st.button("Mark as Settled", key=f"settle_{i}"):
                        st.success("✅ Marked as settled!")
        else:
            st.success("🎉 Everyone is settled up!")
        
        # Detailed balances
        st.subheader("📋 Detailed Balances")
        
        for member_id in group.members:
            member = app.get_user(member_id)
            balances = app.calculate_user_balance(member_id, group.id)
            
            if balances:
                st.write(f"**{member.name}:**")
                for other_user_id, amount in balances.items():
                    other_user = app.get_user(other_user_id)
                    if amount > 0:
                        st.markdown(f'<p class="balance-positive">  • {other_user.name} owes ${amount:.2f}</p>', unsafe_allow_html=True)
                    elif amount < 0:
                        st.markdown(f'<p class="balance-negative">  • Owes {other_user.name} ${abs(amount):.2f}</p>', unsafe_allow_html=True)
            else:
                st.write(f"**{member.name}:** ✅ Settled up")
    
    else:
        st.info("Select a group to manage settlements!")

# Footer
st.markdown("---")
st.markdown("💡 **Tip:** Use the sidebar to switch between users and groups. All data is stored in memory for this demo.")
