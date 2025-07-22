# Invoice AI Agent for Telegram
# Complete system with Google Drive integration and ChatGPT processing

import os
import io
import csv
import json
import logging
import asyncio
from datetime import datetime
from typing import Dict, List, Optional

import openai
from dotenv import load_dotenv
from telegram import Update
from telegram.ext import Application, MessageHandler, filters, ContextTypes
from googleapiclient.discovery import build
from googleapiclient.http import MediaIoBaseDownload, MediaIoBaseUpload
from google.oauth2.credentials import Credentials
from google.auth.transport.requests import Request
from google_auth_oauthlib.flow import InstalledAppFlow

# Load Environment Variables
load_dotenv()

# Configure logging
logging.basicConfig(
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s',
    level=logging.INFO
)
logger = logging.getLogger(__name__)

# Configuration
class Config:
    TELEGRAM_BOT_TOKEN = os.getenv('TELEGRAM_BOT_TOKEN')
    OPENAI_API_KEY = os.getenv('OPENAI_API_KEY')
    GOOGLE_DRIVE_FOLDER_ID = os.getenv('GOOGLE_DRIVE_FOLDER_ID')  # Optional: specific folder
    CSV_FILE_NAME = 'invoice_data.csv'
    SCOPES = ['https://www.googleapis.com/auth/drive']

class GoogleDriveManager:
    def __init__(self):
        self.service = None
        self.authenticate()

    def authenticate(self):
        """Authenticate with Google Drive API"""
        creds = None
        # The file token.json stores the user's access and refresh tokens
        if os.path.exists('token.json'):
            creds = Credentials.from_authorized_user_file('token.json', Config.SCOPES)
        
        # If there are no (valid) credentials available, let the user log in
        if not creds or not creds.valid:
            if creds and creds.expired and creds.refresh_token:
                creds.refresh(Request())
            else:
                flow = InstalledAppFlow.from_client_secrets_file(
                    'credentials.json', Config.SCOPES)
                creds = flow.run_local_server(port=0)
            
            # Save the credentials for the next run
            with open('token.json', 'w') as token:
                token.write(creds.to_json())

        self.service = build('drive', 'v3', credentials=creds)

    def upload_image(self, image_data: bytes, filename: str) -> str:
        """Upload image to Google Drive and return file ID"""
        try:
            media = MediaIoBaseUpload(
                io.BytesIO(image_data), 
                mimetype='image/jpeg',
                resumable=True
            )
            
            file_metadata = {
                'name': filename,
                'parents': [Config.GOOGLE_DRIVE_FOLDER_ID] if Config.GOOGLE_DRIVE_FOLDER_ID else []
            }
            
            file = self.service.files().create(
                body=file_metadata,
                media_body=media,
                fields='id'
            ).execute()
            
            logger.info(f"Image uploaded successfully. File ID: {file.get('id')}")
            return file.get('id')
            
        except Exception as e:
            logger.error(f"Failed to upload image: {str(e)}")
            raise

    def get_or_create_csv(self) -> str:
        """Get existing CSV file ID or create new one"""
        try:
            # Search for existing CSV file
            query = f"name='{Config.CSV_FILE_NAME}' and trashed=false"
            if Config.GOOGLE_DRIVE_FOLDER_ID:
                query += f" and '{Config.GOOGLE_DRIVE_FOLDER_ID}' in parents"
            
            results = self.service.files().list(q=query).execute()
            files = results.get('files', [])
            
            if files:
                return files[0]['id']
            else:
                # Create new CSV file with headers
                headers = ['Date', 'Vendor', 'Item', 'Amount', 'Category', 'Remarks']
                csv_content = io.StringIO()
                writer = csv.writer(csv_content)
                writer.writerow(headers)
                
                media = MediaIoBaseUpload(
                    io.BytesIO(csv_content.getvalue().encode()),
                    mimetype='text/csv'
                )
                
                file_metadata = {
                    'name': Config.CSV_FILE_NAME,
                    'parents': [Config.GOOGLE_DRIVE_FOLDER_ID] if Config.GOOGLE_DRIVE_FOLDER_ID else []
                }
                
                file = self.service.files().create(
                    body=file_metadata,
                    media_body=media,
                    fields='id'
                ).execute()
                
                return file.get('id')
                
        except Exception as e:
            logger.error(f"Failed to get/create CSV: {str(e)}")
            raise

    def update_csv(self, file_id: str, invoice_data: Dict):
        """Update CSV file with new invoice data"""
        try:
            # Download existing CSV
            request = self.service.files().get_media(fileId=file_id)
            downloaded = io.BytesIO()
            downloader = MediaIoBaseDownload(downloaded, request)
            done = False
            while done is False:
                status, done = downloader.next_chunk()
            
            # Read existing data
            downloaded.seek(0)
            existing_data = downloaded.read().decode('utf-8')
            
            # Append new data
            csv_content = io.StringIO(existing_data)
            csv_content.seek(0, io.SEEK_END)  # Go to end
            
            writer = csv.writer(csv_content)
            new_row = [
                datetime.now().strftime('%Y-%m-%d %H:%M:%S'),
                invoice_data.get('vendor', ''),
                invoice_data.get('item', ''),
                invoice_data.get('amount', ''),
                invoice_data.get('category', ''),
                ''
            ]
            writer.writerow(new_row)
            
            # Upload updated CSV
            media = MediaIoBaseUpload(
                io.BytesIO(csv_content.getvalue().encode()),
                mimetype='text/csv'
            )
            
            self.service.files().update(
                fileId=file_id,
                media_body=media
            ).execute()
            
            logger.info("CSV updated successfully")
            
        except Exception as e:
            logger.error(f"Failed to update CSV: {str(e)}")
            raise

class InvoiceProcessor:
    def __init__(self):
        openai.api_key = Config.OPENAI_API_KEY

    def extract_invoice_data(self, image_data: bytes) -> Dict:
        """Extract invoice data using ChatGPT Vision"""
        try:
            import base64
            
            # Encode image to base64
            image_base64 = base64.b64encode(image_data).decode('utf-8')
            
            response = openai.chat.completions.create(
                model="gpt-4-vision-preview",
                messages=[
                    {
                        "role": "user",
                        "content": [
                            {
                                "type": "text",
                                "text": """
                                Analyze this invoice image and extract the following information in JSON format:
                                {
                                    "vendor": "string",
                                    "item": "string",
                                    "amount": "number",
                                    "category": "string"
                                }
                                If any field cannot be found, use null or empty string. Be precise with numbers and dates.
                                """
                            },
                            {
                                "type": "image_url",
                                "image_url": {
                                    "url": f"data:image/jpeg;base64,{image_base64}"
                                }
                            }
                        ]
                    }
                ],
                max_tokens=1000
            )
            
            # Parse JSON response
            content = response.choices[0].message.content.strip()
            
            # Extract JSON from response (in case there's extra text)
            if '```json' in content:
                content = content.split('```json')[1].split('```')[0].strip()
            elif '{' in content:
                start = content.find('{')
                end = content.rfind('}') + 1
                content = content[start:end]
            
            invoice_data = json.loads(content)
            logger.info(f"Extracted invoice data: {invoice_data}")
            return invoice_data
            
        except Exception as e:
            logger.error(f"Failed to extract invoice data: {str(e)}")
            # Return default structure if extraction fails
            return {
                "vendor": "Unknown",
                "amount": 0,
                "item": "Invoice processing failed",
                "category": ""
            }

    def create_summary_message(self, invoice_data: Dict) -> str:
        """Create a summary message using ChatGPT"""
        try:
            prompt = f"""
            Create a friendly and professional summary message for this invoice data:
            {json.dumps(invoice_data, indent=2)}
            
            The message should:
            1. Thank the user for submitting the invoice
            2. Summarize the key details (vendor, amount, etc.)
            3. Mention that it has been saved to their records
            4. Be concise but informative
            5. Use emojis appropriately
            
            Format it as a Telegram message.
            """
            
            response = openai.chat.completions.create(
                model="gpt-3.5-turbo",
                messages=[{"role": "user", "content": prompt}],
                max_tokens=300
            )
            
            return response.choices[0].message.content.strip()
            
        except Exception as e:
            logger.error(f"Failed to create summary: {str(e)}")
            # Fallback message
            return f"""
📄 Invoice Processed Successfully!

🏢 Vendor: {invoice_data.get('vendor', 'N/A')}
🔢 Item: {invoice_data.get('item', 'N/A')}
💰 Amount: {invoice_data.get('amount', 'N/A')}
📋 Category: {invoice_data.get('category', 'N/A')}

✅ Your invoice has been saved to Google Drive and added to your records.
            """

class InvoiceBot:
    def __init__(self):
        self.drive_manager = GoogleDriveManager()
        self.processor = InvoiceProcessor()

    async def handle_image(self, update: Update, context: ContextTypes.DEFAULT_TYPE):
        """Handle incoming invoice images"""
        try:
            # Send processing message
            await update.message.reply_text("🔄 Processing your invoice... Please wait!")
            
            # Get the largest photo
            photo = update.message.photo[-1]
            file = await context.bot.get_file(photo.file_id)
            
            # Download image
            image_data = await file.download_as_bytearray()
            
            # Generate filename
            timestamp = datetime.now().strftime('%Y%m%d_%H%M%S')
            filename = f"invoice_{timestamp}.jpg"
            
            # Upload to Google Drive
            file_id = self.drive_manager.upload_image(bytes(image_data), filename)
            
            # Extract invoice data
            invoice_data = self.processor.extract_invoice_data(bytes(image_data))
            
            # Update CSV
            csv_file_id = self.drive_manager.get_or_create_csv()
            self.drive_manager.update_csv(csv_file_id, invoice_data)
            
            # Create summary message
            summary = self.processor.create_summary_message(invoice_data)
            
            # Send summary to user
            await update.message.reply_text(summary)
            
            logger.info(f"Successfully processed invoice for user {update.effective_user.id}")
            
        except Exception as e:
            logger.error(f"Error processing invoice: {str(e)}")
            await update.message.reply_text(
                "❌ Sorry, there was an error processing your invoice. Please try again or contact support."
            )

    async def handle_text(self, update: Update, context: ContextTypes.DEFAULT_TYPE):
        """Handle text messages"""
        text = update.message.text.lower()
        
        if any(word in text for word in ['hello', 'hi', 'start', 'help']):
            welcome_message = """
👋 Welcome to the Invoice AI Agent!

📱 **How to use:**
1. Simply send me a photo of your invoice
2. I'll automatically save it to Google Drive
3. Extract all the important information
4. Add it to your invoice database
5. Send you a summary

🔧 **Features:**
✅ Automatic invoice data extraction
✅ Google Drive storage
✅ CSV database management
✅ Smart summaries

Just send me an invoice photo to get started! 📸
            """
            await update.message.reply_text(welcome_message)
        else:
            await update.message.reply_text(
                "Please send me an invoice image to process, or type 'help' for instructions."
            )

def main():
    """Main function to run the bot"""
    # Validate configuration
    if not all([Config.TELEGRAM_BOT_TOKEN, Config.OPENAI_API_KEY]):
        logger.error("Missing required environment variables")
        return
    
    # Check for required files
    if not os.path.exists('credentials.json'):
        logger.error("credentials.json file not found. Please download it from Google Cloud Console.")
        return
    
    # Create application
    application = Application.builder().token(Config.TELEGRAM_BOT_TOKEN).build()
    
    # Create bot instance
    bot = InvoiceBot()
    
    # Add handlers
    application.add_handler(MessageHandler(filters.PHOTO, bot.handle_image))
    application.add_handler(MessageHandler(filters.TEXT & ~filters.COMMAND, bot.handle_text))
    
    # Start bot
    logger.info("Starting Invoice AI Agent...")
    application.run_polling(allowed_updates=Update.ALL_TYPES)

if __name__ == '__main__':
    main()
