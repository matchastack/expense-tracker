from datetime import datetime

expenses = {}

def add_expense(description, amount):
    """Adds an expense to the expenses dictionary."""
    date = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    expenses[date] = {'description': description, 'amount': amount}
    print(f"Expense added: {description} - ${amount} on {date}")

def view_expenses():
    """Displays all recorded expenses."""
    if not expenses:
        print("No expenses recorded.")
        return
    
    print("Recorded Expenses:")
    for date, details in expenses.items():
        print(f"{date}: {details['description']} - ${details['amount']}")

def main():
    while True:
        print("\nWhat would you like to do?")
        print("1. Add Expense")
        print("2. View Expenses")
        print("3. Exit")
        
        choice = input("Choose an option: ")
        
        if choice == '1':
            description = input("Enter expense description: ")
            amount = float(input("Enter expense amount: "))
            add_expense(description, amount)
        elif choice == '2':
            view_expenses()
        elif choice == '3':
            print("Exiting the Expense Tracker.")
            break
        else:
            print("Invalid choice. Please try again.")

if __name__ == "__main__":
    print("Welcome to the Expense Tracker!")
    main()
