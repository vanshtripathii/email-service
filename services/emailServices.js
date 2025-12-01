const nodemailer = require('nodemailer');
require('dotenv').config();

console.log('=== EMAIL DEBUG INFO ===');
console.log('EMAIL_USER:', process.env.EMAIL_USER);
console.log('EMAIL_PASSWORD length:', process.env.EMAIL_PASSWORD ? process.env.EMAIL_PASSWORD.length : 'MISSING');
console.log('Current directory:', __dirname);
console.log('====================');

// TEMPORARY: Hardcode your credentials to test
const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: 'gadzooksoffside@gmail.com', // ← REPLACE WITH YOUR REAL EMAIL
    pass: 'zvtw qfav zsqk ifoc'            // ← REPLACE WITH YOUR REAL APP PASSWORD
  }
});

// Test the connection
transporter.verify(function(error, success) {
  if (error) {
    console.log('❌ Email connection failed:', error.message);
  } else {
    console.log('✅ Email server is ready to send messages');
  }
});

// Welcome Email Template
const welcomeEmailTemplate = (email) => {
  return {
    from: `GADzooks <${process.env.EMAIL_USER}>`,
    to: email,
    subject: 'Welcome to the GADzooks Cult 🖤',
    html: `
      <!DOCTYPE html>
      <html>
      <head>
        <style>
          body { 
            font-family: 'Montserrat', Arial, sans-serif; 
            background-color: #000000; 
            color: #ffffff; 
            margin: 0; 
            padding: 0; 
          }
          .container { 
            max-width: 600px; 
            margin: 0 auto; 
            background-color: #000000; 
          }
          .header { 
            text-align: center; 
            padding: 40px 20px; 
            border-bottom: 1px solid #5c5c5cff;
          }
          .logo { 
            font-size: 28px; 
            font-weight: 200; 
            letter-spacing: 3px; 
            margin-bottom: 10px;
          }
          .tagline {
            font-size: 14px;
            color: #ffffffff;
            letter-spacing: 1px;
            text-transform: uppercase;
          }
          .content { 
            padding: 40px 30px; 
            line-height: 1.6;
          }
          .welcome-title {
            font-size: 24px;
            margin-bottom: 20px;
            font-weight: 300;
            letter-spacing: 1px;
          }
          .cult-message {
            background-color: #111111;
            padding: 25px;
            border: 1px solid #ffffffff;
            margin: 25px 0;
            text-align: center;
          }
          .updates-section {
            margin: 30px 0;
            padding: 25px;
            background-color: #111111;
            border-left: 3px solid #ffffff;
          }
          .update-item {
            margin-bottom: 15px;
            padding-bottom: 15px;
            border-bottom: 1px solid #ffffffff;
          }
          .update-item:last-child {
            border-bottom: none;
            margin-bottom: 0;
          }
          .social-links {
            text-align: center;
            padding: 30px;
            border-top: 1px solid #333333;
          }
          .social-link {
            color: #ffffff;
            text-decoration: none;
            margin: 0 15px;
            font-size: 13px;
            text-transform: uppercase;
            letter-spacing: 1px;
          }
          .footer { 
            text-align: center; 
            padding: 30px 20px; 
            color: #ffffffff; 
            font-size: 12px; 
            border-top: 1px solid #ffffffff;
          }
          .highlight {
            color: #ffffff;
            font-weight: 400;
          }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <div class="logo">GADZOOKS</div>
            <div class="tagline">MAY CAUSE ENVY, AWE, AND REPEAT WEARS</div>
          </div>
          
          <div class="content">
            <h1 class="welcome-title">Welcome to Our Cult</h1>
            
            <p>We've been expecting you.</p>
            
            <div class="cult-message">
              <p><strong>You're now part of something exclusive.</strong></p>
              <p>GADzooks isn't just clothing—it's a statement. It's for those who understand that fashion should cause envy, inspire awe, and demand repeat wears.</p>
            </div>

            <p>As a member of our inner circle, you'll be the first to know about:</p>
            
            <div class="updates-section">
              <div class="update-item">
                <strong>• New Collection Drops</strong><br>
                Get exclusive early access to our latest creations before anyone else.
              </div>
              <div class="update-item">
                <strong>• Behind-the-Scenes Content</strong><br>
                Peek into our creative process and the stories behind each piece.
              </div>
              <div class="update-item">
                <strong>• Exclusive Events</strong><br>
                Invitations to private viewings, collaborations, and cult gatherings.
              </div>
              <div class="update-item">
                <strong>• Artistic Collaborations</strong><br>
                First look at our partnerships with visionary artists and designers.
              </div>
            </div>

            <p>Our current <span class="highlight">Masochism Collection</span> is available now—each piece a standalone work of art for those who dare to stand out.</p>
            
            <p>We don't follow trends. We create them. And now, you're part of that creation.</p>
            
            <p>Welcome to the cult. We're thrilled to have you.</p>
          </div>

          <div class="social-links">
            <a href="https://instagram.com/gadzooksoffside" class="social-link">Instagram</a>
            <a href="#" class="social-link">Lookbook</a>
            <a href="#" class="social-link">Collections</a>
          </div>
          
          <div class="footer">
            <p>GADzooks • For the few who get it</p>
            <p>© 2023 GADzooks. All rights reserved.</p>
            <p>This email was sent to ${email} because you subscribed to our cult.</p>
            <p><a href="#" style="color: #ffffffff; text-decoration: underline;">Unsubscribe</a> if this wasn't you.</p>
          </div>
        </div>
      </body>
      </html>
    `
  };
};

// UPDATES EMAIL TEMPLATE - THIS WAS MISSING!
const updatesEmailTemplate = (email, updates) => {
  const update = updates[0]; // Take the first update
  
  return {
    from: `GADzooks <gadzooksoffside@gmail.com>`,
    to: email,
    subject: update.title || 'Update from GADzooks',
    html: `
      <!DOCTYPE html>
      <html>
      <head>
        <style>
          body { 
            font-family: 'Montserrat', Arial, sans-serif; 
            background-color: #000000; 
            color: #ffffff; 
            margin: 0; 
            padding: 0; 
          }
          .container { 
            max-width: 600px; 
            margin: 0 auto; 
            background-color: #000000; 
          }
          .header { 
            text-align: center; 
            padding: 40px 20px; 
            border-bottom: 1px solid #333333;
          }
          .logo { 
            font-size: 28px; 
            font-weight: 200; 
            letter-spacing: 3px; 
            margin-bottom: 10px;
          }
          .tagline {
            font-size: 14px;
            color: #999999;
            letter-spacing: 1px;
            text-transform: uppercase;
          }
          .content { 
            padding: 40px 30px; 
            line-height: 1.6;
          }
          .update-title {
            font-size: 24px;
            margin-bottom: 20px;
            font-weight: 300;
            letter-spacing: 1px;
            color: #ffffff;
          }
          .update-content {
            background-color: #111111;
            padding: 25px;
            border: 1px solid #333333;
            margin: 25px 0;
            font-size: 16px;
            line-height: 1.8;
            white-space: pre-wrap;
          }
          .button {
            display: inline-block;
            background-color: #ffffff;
            color: #000000;
            padding: 12px 30px;
            text-decoration: none;
            font-weight: 500;
            letter-spacing: 1px;
            margin: 20px 0;
            border: none;
            cursor: pointer;
          }
          .social-links {
            text-align: center;
            padding: 30px;
            border-top: 1px solid #333333;
          }
          .social-link {
            color: #ffffff;
            text-decoration: none;
            margin: 0 15px;
            font-size: 13px;
            text-transform: uppercase;
            letter-spacing: 1px;
          }
          .footer { 
            text-align: center; 
            padding: 30px 20px; 
            color: #666666; 
            font-size: 12px; 
            border-top: 1px solid #333333;
          }
          .unsubscribe {
            color: #999999;
            font-size: 11px;
            margin-top: 20px;
          }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <div class="logo">GADZOOKS</div>
            <div class="tagline">MAY CAUSE ENVY, AWE, AND REPEAT WEARS</div>
          </div>
          
          <div class="content">
            <h1 class="update-title">${update.title || 'Update from GADzooks'}</h1>
            
            <div class="update-content">
              ${update.content.replace(/\n/g, '<br>') || 'Stay tuned for more updates from GADzooks.'}
            </div>

            ${update.link ? `
            <div style="text-align: center;">
              <a href="${update.link}" class="button" style="color: #000000; text-decoration: none;">Learn More</a>
            </div>
            ` : ''}

            <p>Thank you for being part of the GADzooks community.</p>
            
            <div class="unsubscribe">
              <p><a href="#" style="color: #999999; text-decoration: underline;">Unsubscribe</a> from these updates</p>
            </div>
          </div>

          <div class="social-links">
            <a href="https://instagram.com/gadzooksoffside" class="social-link">Instagram</a>
            <a href="#" class="social-link">Lookbook</a>
            <a href="#" class="social-link">Collections</a>
          </div>
          
          <div class="footer">
            <p>GADzooks • For the few who get it</p>
            <p>© 2023 GADzooks. All rights reserved.</p>
            <p>This email was sent to ${email} as part of your GADzooks subscription.</p>
          </div>
        </div>
      </body>
      </html>
    `
  };
};

// Function to send welcome email
const sendWelcomeEmail = async (email) => {
  try {
    const mailOptions = welcomeEmailTemplate(email);
    // Temporarily hardcode the from address too
    mailOptions.from = `GADzooks <gadzooksoffside@gmail.com>`; // ← USE SAME EMAIL
    
    const result = await transporter.sendMail(mailOptions);
    console.log(`✅ Welcome email sent to: ${email}`);
    console.log(`📧 Message ID: ${result.messageId}`);
    return true;
  } catch (error) {
    console.error('❌ Error sending welcome email:', error.message);
    console.error('Full error:', error);
    return false;
  }
};

// Function to send updates email
const sendUpdatesEmail = async (email, updates) => {
  try {
    console.log(`📧 Preparing to send update email to: ${email}`);
    console.log(`📧 Update title: ${updates[0]?.title}`);
    
    const mailOptions = updatesEmailTemplate(email, updates);
    mailOptions.from = `GADzooks <gadzooksoffside@gmail.com>`; // ← USE SAME EMAIL
    
    const result = await transporter.sendMail(mailOptions);
    console.log(`✅ Updates email sent to: ${email}`);
    console.log(`📧 Message ID: ${result.messageId}`);
    return true;
  } catch (error) {
    console.error(`❌ Error sending updates email to ${email}:`, error.message);
    console.error('Full error:', error);
    return false;
  }
};


module.exports = {
  sendWelcomeEmail,
  sendUpdatesEmail,
  updatesEmailTemplate,
};
