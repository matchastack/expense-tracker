# SplitWiser - Expense Splitting Application

A web-based expense splitting application built with Python, PostgreSQL, and Streamlit. Split expenses with friends and groups, track balances, and settle debts easily.

## Features

- 👤 **User Management**: Create and manage user profiles
- 👥 **Group Management**: Create groups and add members
- 💸 **Expense Tracking**: Add expenses with flexible splitting options (equal, exact amounts, or percentages)
- 📊 **Analytics**: Visualize expenses by category, member contributions, and timeline
- ⚖️ **Smart Settlements**: Get optimized settlement suggestions to minimize transactions
- 💾 **Persistent Storage**: All data stored in PostgreSQL database

## Prerequisites

- Python 3.8 or higher
- PostgreSQL 12 or higher
- pip (Python package manager)

## Installation

1. **Clone the repository**
   ```bash
   git clone https://github.com/matchastack/expense-tracker.git
   cd expense-tracker
   ```

2. **Create a virtual environment** (recommended)
   ```bash
   python -m venv venv
   
   # On Windows
   venv\Scripts\activate
   
   # On macOS/Linux
   source venv/bin/activate
   ```

3. **Install dependencies**
   ```bash
   pip install -r requirements.txt
   ```

4. **Set up the database**
   
   Run the setup script:
   ```bash
   python setup_db.py
   ```
   
   This will:
   - Prompt you for PostgreSQL connection details
   - Create the database
   - Initialize the schema
   - Create a `.env` file with your configuration

   Alternatively, you can set up manually:
   - Create a PostgreSQL database named `splitwise_db`
   - Run the SQL script: `psql -U postgres -d splitwise_db -f init_db.sql`
   - Create a `.env` file in the project root with:
     ```
     DB_HOST=localhost
     DB_PORT=5432
     DB_USER=postgres
     DB_PASSWORD=your_password
     DB_NAME=splitwise_db
     ```

## Running the Application

1. **Start the Streamlit app**
   ```bash
   streamlit run src/app.py
   ```

2. **Open your browser**
   - The app will automatically open at `http://localhost:8501`
   - If not, navigate to this URL manually

## Usage Guide

### Getting Started
1. **Create a User**: Use the sidebar to create your user profile
2. **Create a Group**: Navigate to "Manage Groups" tab to create your first group
3. **Add Members**: Invite other users to your group
4. **Add Expenses**: Start tracking shared expenses

### Adding Expenses
- Select the group in the sidebar
- Go to "Add Expense" tab
- Fill in the expense details
- Choose split type:
  - **Equal**: Split evenly among selected members
  - **Exact**: Specify exact amounts for each person
  - **Percentage**: Split by percentage

### Viewing Analytics
- Select a group to see expense analytics
- View expenses by category, member contributions, and timeline

### Settling Up
- Go to "Settle Up" tab to see optimized settlement suggestions
- Mark settlements as complete when payments are made

## Project Structure

```
expense-tracker/
├── src/
│   ├── app.py          # Streamlit web interface
│   ├── models.py       # Database models and operations
│   ├── db.py           # Database connection utilities
│   └── main.py         # Original in-memory implementation (reference)
├── init_db.sql         # Database schema
├── setup_db.py         # Database setup script
├── requirements.txt    # Python dependencies
├── .gitignore         # Git ignore file
└── README.md          # This file
```

## Database Schema

The application uses the following main tables:
- `users`: User profiles
- `groups`: Expense groups
- `group_memberships`: User-group relationships
- `expenses`: Expense records
- `expense_splits`: How expenses are divided
- `settlements`: Payment records
- `activity_log`: Activity tracking

## Development

### Running Tests
```bash
python -m pytest tests/
```

### Database Migrations
For schema changes, create migration scripts in a `migrations/` directory.

### Contributing
1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Submit a pull request

## Troubleshooting

### Database Connection Issues
- Ensure PostgreSQL is running
- Check `.env` file has correct credentials
- Verify database exists: `psql -U postgres -l`

### Import Errors
- Ensure you're in the virtual environment
- Reinstall dependencies: `pip install -r requirements.txt`

### Streamlit Issues
- Clear Streamlit cache: `streamlit cache clear`
- Check for port conflicts (default 8501)

## License

This project is licensed under the MIT License.

## Acknowledgments

Inspired by Splitwise for expense sharing functionality.
