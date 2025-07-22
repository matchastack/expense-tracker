# Invoice AI Agent Setup Guide

## Prerequisites
- Python 3.8 or higher
- Google Cloud Project with Drive API enabled
- OpenAI API account
- Telegram Bot Token

## Step-by-Step Setup

### 1. Clone and Install Dependencies
```bash
git clone <your-repo>
cd invoice-ai-agent
pip install -r requirements.txt
```

### 2. Create Telegram Bot
1. Message @BotFather on Telegram
2. Use `/newbot` command
3. Follow instructions to create your bot
4. Save the bot token

### 3. Set up Google Drive API
1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Create a new project or select existing one
3. Enable Google Drive API
4. Create credentials (OAuth 2.0 Client IDs)
5. Download the credentials file as `credentials.json`
6. Place `credentials.json` in the project root directory

### 4. Get OpenAI API Key
1. Go to [OpenAI Platform](https://platform.openai.com/)
2. Create an account or sign in
3. Navigate to API Keys section
4. Create a new API key
5. Save the key securely

### 5. Set Environment Variables
Create a `.env` file in the project root:

```env
TELEGRAM_BOT_TOKEN=your_telegram_bot_token_here
OPENAI_API_KEY=your_openai_api_key_here
GOOGLE_DRIVE_FOLDER_ID=optional_specific_folder_id
```

### 6. Run the Bot
```bash
python invoice_agent.py
```

## First Run
1. The bot will open a browser for Google OAuth authentication
2. Grant necessary permissions
3. The bot will create a `token.json` file for future use
4. Start sending invoice images to your Telegram bot!

## File Structure
```
invoice-ai-agent/
├── invoice_agent.py       # Main bot code
├── requirements.txt       # Python dependencies
├── credentials.json       # Google API credentials (download from Google Cloud)
├── token.json            # Auto-generated after first OAuth
├── .env                  # Environment variables
└── README.md             # This setup guide
```

## Features

### 🤖 **Automated Processing**
- Receives invoice images via Telegram
- Uploads images to Google Drive automatically
- Extracts data using ChatGPT Vision API
- Updates CSV database in Google Drive
- Sends intelligent summary back to user

### 📊 **Data Extraction**
The AI extracts:
- Vendor name
- Description/items
- Total amount
- Category

### 💾 **Storage**
- Images saved to Google Drive with timestamps
- CSV database with all invoice data
- Organized folder structure (if folder ID specified)

### 🔒 **Security**
- OAuth2 authentication for Google Drive
- Environment variables for sensitive data
- Secure token management

## Usage

### Basic Commands
- Send "hello", "hi", or "help" for instructions
- Send any invoice image to process it
- The bot responds with extracted information summary

### CSV Structure
The generated CSV includes these columns:
- Date (processing timestamp)
- Vendor
- Item
- Amount
- Category
- Remarks

## Troubleshooting

### Common Issues

1. **"credentials.json not found"**
   - Download OAuth2 credentials from Google Cloud Console
   - Place file in project root directory

2. **"Invalid token" error**
   - Check your Telegram bot token
   - Verify environment variables are set correctly

3. **Google Drive permission denied**
   - Re-run authentication process
   - Check API is enabled in Google Cloud Console

4. **OpenAI API errors**
   - Verify API key is correct
   - Check you have sufficient credits/quota

5. **Image processing fails**
   - Ensure image is clear and readable
   - Try with different image formats
   - Check OpenAI Vision API availability

### Logs
The bot logs all activities. Check console output for detailed error messages.

## Advanced Configuration

### Custom Google Drive Folder
Set `GOOGLE_DRIVE_FOLDER_ID` environment variable to save files to a specific folder.

### CSV Customization
Modify the `headers` list in `get_or_create_csv()` method to change CSV structure.

### Response Customization
Edit the prompt in `create_summary_message()` to customize AI responses.

## Support
- Check logs for error messages
- Verify all API keys and credentials
- Ensure all required files are in place
- Test with simple, clear invoice images first