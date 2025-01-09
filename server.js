const express = require('express')
const { MongoClient, ObjectId } = require('mongodb')
const cors = require('cors')
const e = require('express')
require('dotenv').config()

// Initialize app and middleware
const app = express()
app.use(cors())
app.use(express.json())

// MongoDB connection
const uri = process.env.MONGO_URI
const client = new MongoClient(uri)

// Database and collection names
const dbName = 'expenseTracker'
const expensesCollection = 'expenses'
const limitsCollection = 'limits'

// Connect to MongoDB
client.connect().then(() => console.log('Connected to MongoDB'))
const db = client.db(dbName)

// Routes

// Add an expense
app.post('/api/expenses', async (req, res) => {
  try {
    const { category, amount, purpose } = req.body
    if (!category || !amount || !purpose) {
      return res.status(400).json({ error: 'All fields are required.' })
    }

    const date = new Date().toISOString()

    // Check spending limit
    const limit = await db.collection(limitsCollection).findOne({ category })
    const expenses = await db
      .collection(expensesCollection)
      .find({ category })
      .toArray()

    // Calculate the total spent manually
    const totalSpent = expenses.reduce(
      (sum, expense) => sum + expense.amount,
      0
    )
    if (limit && totalSpent + amount > limit.amount) {
      return res
        .status(400)
        .json({ error: `Spending limit exceeded for ${category}.` })
    }

    // Add the new expense
    const newExpense = { category, amount, purpose, date }
    const result = await db.collection(expensesCollection).insertOne(newExpense)

    res
      .status(201)
      .json({ message: 'Expense added', expenseId: result.insertedId })
  } catch (err) {
    console.error('Error adding expense:', err)
    res.status(500).json({ error: 'Failed to add expense.' })
  }
})

// Get all expenses
app.get('/api/expenses', async (req, res) => {
  try {
    const expenses = await db.collection(expensesCollection).find().toArray()
    res.json(expenses)
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch expenses.' })
  }
})

//Update an expense
app.put('/api/expenses/:id', async (req, res) => {
  try {
    const expenseId = new ObjectId(req.params.id)
    const { category, amount, purpose } = req.body
    const result = await db
      .collection(expensesCollection)
      .updateOne({ _id: expenseId }, { $set: { category, amount, purpose } })
    if (result.modifiedCount === 1) {
      res.json({ message: 'Expense updated successfully.' })
    } else {
      res.status(404).json({ error: 'Expense not found.' })
    }
  } catch (err) {
    console.error('Error updating expense:', err)
    res.status(500).json({ error: 'Failed to update expense.' })
  }
})

// Delete an expense
app.delete('/api/expenses/:id', async (req, res) => {
  try {
    const expenseId = new ObjectId(req.params.id)
    const result = await db
      .collection(expensesCollection)
      .deleteOne({ _id: expenseId })
    if (result.deletedCount === 1) {
      res.json({ message: 'Expense deleted successfully.' })
    } else {
      res.status(404).json({ error: 'Expense not found.' })
    }
  } catch (err) {
    console.error('Error deleting expense:', err)
    res.status(500).json({ error: 'Failed to delete expense.' })
  }
})

// Set spending limits
app.post('/api/limits', async (req, res) => {
  try {
    const { category, amount } = req.body
    if (!category || !amount) {
      return res.status(400).json({ error: 'All fields are required.' })
    }

    const result = await db
      .collection(limitsCollection)
      .updateOne({ category }, { $set: { amount } }, { upsert: true })
    res.status(200).json({ message: 'Limit set successfully.' })
  } catch (err) {
    res.status(500).json({ error: 'Failed to set limit.' })
  }
})

// get spending limits
app.get('/api/limits', async (req, res) => {
  try {
    const limits = await db.collection(limitsCollection).find().toArray()
    res.json(limits)
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch limits.' })
  }
})

// Update spending limits
app.put('/api/limits/:category', async (req, res) => {
  try {
    const category = req.params.category
    const { amount } = req.body
    const result = await db
      .collection(limitsCollection)
      .updateOne({ category }, { $set: { amount } })
    if (result.modifiedCount === 1) {
      res.json({ message: 'Limit updated successfully.' })
    } else {
      res.status(404).json({ error: 'Limit not found.' })
    }
  } catch (err) {
    res.status(500).json({ error: 'Failed to update limit.' })
  }
})

// Delete spending limits & all expenses
app.delete('/api/categories/:id', async (req, res) => {
  try {
    const { id } = req.params

    // Find the category (limit) by ID in the limits collection
    const limit = await db
      .collection(limitsCollection)
      .findOne({ _id: new ObjectId(id) })
    if (!limit) {
      return res.status(404).json({ error: 'Limit not found' })
    }

    // Delete all expenses associated with the category
    await db
      .collection(expensesCollection)
      .deleteMany({ category: limit.category })

    // Delete the category (limit) itself
    await db.collection(limitsCollection).deleteOne({ _id: new ObjectId(id) })

    res.status(200).json({
      message: 'All expenses and the category limit deleted successfully!',
    })
  } catch (error) {
    console.error('Error deleting category and expenses:', error)
    res
      .status(500)
      .json({ error: 'Server error while deleting category and expenses.' })
  }
})

// Get expense summaries for a full month
app.get('/api/expenses/summary', async (req, res) => {
  try {
    const { month, year } = req.query

    if (!month || !year) {
      return res.status(400).json({ error: 'Month and year are required.' })
    }

    // Parse month and year
    const startDate = new Date(year, month - 1, 1) // First day of the month
    const endDate = new Date(year, month, 0) // Last day of the month
    endDate.setHours(23, 59, 59, 999) // Set to end of the day

    // Fetch all expenses for the given month
    const expenses = await db
      .collection(expensesCollection)
      .find({
        date: {
          $gte: startDate.toISOString(),
          $lte: endDate.toISOString(),
        },
      })
      .toArray()

    // Generate a full list of dates for the month
    const daysInMonth = new Date(year, month, 0).getDate()
    const allDates = Array.from({ length: daysInMonth }, (_, i) => {
      const day = new Date(year, month - 1, i + 1)
      return day.toISOString().split('T')[0] // Format: YYYY-MM-DD
    })

    // Fetch all categories from the expenses collection
    const allExpenses = await db.collection(expensesCollection).find().toArray()
    const categories = Array.from(
      new Set(allExpenses.map((expense) => expense.category))
    )

    // Organize data by date and category
    const summary = allDates.map((date) => {
      const row = { date }
      let total = 0 // Initialize total for this row

      // Add category-wise expenses and calculate total
      categories.forEach((category) => {
        const totalExpense = expenses
          .filter(
            (expense) =>
              expense.date.startsWith(date) && expense.category === category
          )
          .reduce((sum, expense) => sum + expense.amount, 0)

        row[category] = totalExpense > 0 ? totalExpense : ''
        total += totalExpense // Add to total sum
      })

      row.total = total
      return row
    })

    res.json({ categories, summary })
  } catch (err) {
    console.error('Error generating expense summary:', err)
    res.status(500).json({ error: 'Failed to generate expense summary.' })
  }
})

// Start server
const PORT = process.env.PORT || 5000
app.listen(PORT, () => console.log(`Server running on port ${PORT}`))
