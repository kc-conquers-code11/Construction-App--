import prisma from '../config/database.js';

/**
 * Recalculates the aggregate totals for a budget based on its categories
 * @param {string} budgetId The ID of the budget to recalculate
 * @param {object} tx Optional Prisma transaction object
 * @returns {object} The updated budget summary
 */
export const recalculateBudgetSummary = async (budgetId, tx = null) => {
  const db = tx || prisma;

  // Fetch the budget to get the contingency amount so we don't lose it
  const budget = await db.budget.findUnique({
    where: { id: budgetId },
    select: { contingencyAmount: true },
  });

  const categories = await db.budgetCategoryAllocation.findMany({
    where: { budgetId },
  });

  let totalAllocated = 0;
  let totalCommitted = 0;
  let totalSpent = 0;

  categories.forEach((cat) => {
    totalAllocated += cat.allocatedAmount || 0;
    totalCommitted += cat.committedAmount || 0;
    totalSpent += cat.spentAmount || 0;
  });

  // Include contingency in totalApproved to preserve the original approved budget
  const totalApproved = totalAllocated + (budget?.contingencyAmount || 0);
  const totalRemaining = totalApproved - (totalCommitted + totalSpent);
  const utilizationRate = totalApproved > 0 ? (totalSpent / totalApproved) * 100 : 0;

  const updatedBudget = await db.budget.update({
    where: { id: budgetId },
    data: {
      totalApproved,
      totalCommitted,
      totalSpent,
      totalRemaining,
      utilizationRate,
    },
  });

  return {
    totalApproved,
    totalCommitted,
    totalSpent,
    totalRemaining,
    utilizationRate,
    budgetId
  };
};

/**
 * Checks if a budget has sufficient balance in a category
 */
export const checkCategoryBalance = async (categoryId, amount, tx = null) => {
  const db = tx || prisma;
  const category = await db.budgetCategoryAllocation.findUnique({
    where: { id: categoryId },
    select: { remainingAmount: true, category: true }
  });

  if (!category) throw new Error('Budget category not found');
  
  if (category.remainingAmount < amount) {
    return {
      success: false,
      available: category.remainingAmount,
      category: category.category
    };
  }

  return { success: true };
};
