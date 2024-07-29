const serverless = require("serverless-http");
const express = require("express");
const admin = require("firebase-admin");
const { MongoClient } = require('mongodb');
const app = express();
const port = 3000;
require('dotenv').config();

app.use(express.json());

const serviceAccount = require('./innocloud-firebase-fcm-key.json');
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});
const MONGODB_URI = process.env.MONGODB_URI;
const DB_NAME = process.env.DB_NAME;
const COLLECTION_NAME = process.env.COLLECTION_NAME;

// MongoDB connection
const uri = MONGODB_URI;

const client = new MongoClient(uri, { useNewUrlParser: true, useUnifiedTopology: true });

async function connectToMongoDB() {
  try {
    await client.connect();
    console.log("Connected to MongoDB");
  } catch (err) {
    console.error("Failed to connect to MongoDB", err);
  }
}

connectToMongoDB();

const db = client.db(DB_NAME);
const usersCollection = db.collection(COLLECTION_NAME);

// Root route
app.get("/", (req, res, next) => {
  return res.status(200).json({
    message: "Hello from root",
  });
});

// Check MongoDB connection route
app.get("/healthcheck", async (req, res) => {
  try {
    await db.collection(COLLECTION_NAME).findOne({});
    res.status(200).json({
      success: true,
      message: "Successfully connected to MongoDB",
    });
  } catch (err) {
    console.error("Error checking MongoDB connection", err);
    res.status(500).json({
      success: false,
      message: "Failed to connect to MongoDB",
      error: err.message,
    });
  }
});

// register the device tokens
app.post("/registerDevice", async (req, res) => {
  const { name, email, deviceToken } = req.body;

  if (!name || !email || !deviceToken) {
    return res.status(400).json({
      success: false,
      message: "Name, email, and device token are required",
    });
  }

  try {
    // Check if the user already exists
    const existingUser = await usersCollection.findOne({ email });

    if (existingUser) {
      await usersCollection.updateOne(
        { email },
        {
          $addToSet: { deviceTokens: deviceToken }  
        }
      );
      return res.status(200).json({
        success: true,
        message: "Device token updated successfully",
        data: await usersCollection.findOne({ email })
      });
    } else {
      // Create a new user document
      const newUser = {
        name,
        email,
        deviceTokens: [deviceToken],  
        registeredAt: new Date()
      };

      const result = await usersCollection.insertOne(newUser);

      if (result.acknowledged) {
        return res.status(200).json({
          success: true,
          message: "User registered successfully",
          data: {
            _id: result.insertedId,
            ...newUser
          }
        });
      } else {
        throw new Error("Failed to register user");
      }
    }
  } catch (err) {
    console.error("Error storing user details:", err);
    return res.status(500).json({
      success: false,
      error: err.message
    });
  }
});



// fetched the tokens by user email
app.get("/getTokenByUsername/:email", async (req, res, next) => {
  const { email } = req.params;

  if (!email) {
    return res.status(400).json({
      success: false,
      message: "Email is required",
    });
  }

  try {
    // Query the database for the user by email
    const user = await usersCollection.findOne({ email });

    if (user) {
      // Get the latest array of device tokens
      const latestDeviceTokens = user.deviceTokens[user.deviceTokens.length - 1] || [];

      return res.status(200).json({
        success: true,
        data: {
          id: user._id.toString(),   
          name: user.name,          
          email: user.email,       
          deviceTokens: latestDeviceTokens,
        },
      });
    } else {
      return res.status(404).json({
        success: false,
        message: "User not found",
      });
    }
  } catch (err) {
    console.error("Error retrieving user data:", err);
    return res.status(500).json({
      success: false,
      error: err.message
    });
  }
});


app.post("/sendNotifcation", async (req, res, next) => {
  const { token, title, body } = req.body;

  const message = {
    notification: {
      title: title,
      body: body
    },
    token: token
  };

  try {
    const response = await admin.messaging().send(message);
    console.log("Successfully sent message:", response);
    return res.status(200).json({
      success: true,
      response
    });
  } catch (error) {
    console.error("Error sending message:", error);
    return res.status(500).json({
      success: false,
      error
    });
  }
});



// 404 route
app.use((req, res, next) => {
  return res.status(404).json({
    error: "Not Found",
  });
});

if (process.env.ENVIRONMENT === 'lambda') {
  // Serverless handler
  module.exports.handler = serverless(app)
} else {
  app.listen(port, () => {
    console.log(`Server listening on ${port}`);
  });
}