const { DataTypes } = require('sequelize');
const { sequelize } = require('../../config/database');
const User = require('./User');
const LP = require('./LP');

const PaymentIntent = sequelize.define('PaymentIntent', {
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true
  },
  amount: {
    type: DataTypes.FLOAT,
    allowNull: false
  },
  currency: {
    type: DataTypes.STRING,
    defaultValue: 'CNY'
  },
  description: {
    type: DataTypes.STRING,
    defaultValue: ''
  },
  platform: {
    type: DataTypes.ENUM('PayPal', 'GCash', 'Alipay', 'WeChat', 'Other'),
    allowNull: false
  },
  merchantInfo: {
    type: DataTypes.JSON,
    defaultValue: {}
  },
  userWalletAddress: {
    type: DataTypes.STRING,
    allowNull: false
  },
  userId: {
    type: DataTypes.INTEGER,
    references: {
      model: User,
      key: 'id'
    }
  },
  lpWalletAddress: {
    type: DataTypes.STRING
  },
  lpId: {
    type: DataTypes.INTEGER,
    references: {
      model: LP,
      key: 'id'
    }
  },
  status: {
    type: DataTypes.ENUM('created', 'claimed', 'paid', 'confirmed', 'settled', 'cancelled', 'expired', 'failed'),
    defaultValue: 'created'
  },
  statusHistory: {
    type: DataTypes.JSON,
    defaultValue: []
  },
  paymentProof: {
    type: DataTypes.JSON,
    defaultValue: {}
  },
  settlementTxHash: {
    type: DataTypes.STRING
  },
  expiresAt: {
    type: DataTypes.DATE,
    defaultValue: () => new Date(Date.now() + 24 * 60 * 60 * 1000) // 默认24小时后过期
  },
  createdAt: {
    type: DataTypes.DATE,
    defaultValue: DataTypes.NOW
  },
  updatedAt: {
    type: DataTypes.DATE,
    defaultValue: DataTypes.NOW
  }
}, {
  tableName: 'payment_intents',
  timestamps: true
});

// 添加关联
PaymentIntent.belongsTo(User, { foreignKey: 'userId' });
PaymentIntent.belongsTo(LP, { foreignKey: 'lpId' });

/**
 * 匹配LP
 * @param {Object} lp - LP对象
 * @returns {Promise<boolean>} - 是否匹配成功
 */
PaymentIntent.prototype.matchLP = async function(lp) {
  try {
    // 检查状态是否为created
    if (this.status !== 'created') {
      return false;
    }
    
    // 锁定LP额度
    const locked = await lp.lockQuota(this.amount);
    if (!locked) {
      return false;
    }
    
    // 更新支付意图状态
    this.status = 'claimed';
    this.lpWalletAddress = lp.walletAddress;
    this.lpId = lp.id;
    
    // 添加状态历史记录
    const statusHistoryEntry = {
      status: 'claimed',
      timestamp: new Date(),
      note: `匹配LP: ${lp.walletAddress}`
    };
    
    if (!Array.isArray(this.statusHistory)) {
      this.statusHistory = [];
    }
    
    this.statusHistory.push(statusHistoryEntry);
    
    await this.save();
    return true;
    
  } catch (error) {
    console.error('匹配LP失败:', error);
    return false;
  }
};

/**
 * 标记LP已支付
 * @param {string} note - 备注
 * @returns {Promise<boolean>} - 是否标记成功
 */
PaymentIntent.prototype.markLPPaid = async function(note) {
  try {
    // 检查状态是否为claimed
    if (this.status !== 'claimed') {
      return false;
    }
    
    // 更新支付意图状态
    this.status = 'paid';
    
    // 添加状态历史记录
    const statusHistoryEntry = {
      status: 'paid',
      timestamp: new Date(),
      note: note || 'LP已完成支付'
    };
    
    if (!Array.isArray(this.statusHistory)) {
      this.statusHistory = [];
    }
    
    this.statusHistory.push(statusHistoryEntry);
    
    await this.save();
    return true;
    
  } catch (error) {
    console.error('标记LP已支付失败:', error);
    return false;
  }
};

/**
 * 用户确认收款
 * @param {string} note - 备注
 * @returns {Promise<boolean>} - 是否确认成功
 */
PaymentIntent.prototype.confirmPayment = async function(note) {
  try {
    // 检查状态是否为paid
    if (this.status !== 'paid') {
      return false;
    }
    
    // 更新支付意图状态
    this.status = 'confirmed';
    
    // 添加状态历史记录
    const statusHistoryEntry = {
      status: 'confirmed',
      timestamp: new Date(),
      note: note || '用户确认收款'
    };
    
    if (!Array.isArray(this.statusHistory)) {
      this.statusHistory = [];
    }
    
    this.statusHistory.push(statusHistoryEntry);
    
    await this.save();
    return true;
    
  } catch (error) {
    console.error('用户确认收款失败:', error);
    return false;
  }
};

module.exports = PaymentIntent;