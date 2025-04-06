const { PaymentIntent, User, LP } = require('../models/mysql');
const { parseQRCode, identifyPaymentPlatform } = require('../utils/qrcode.utils');
const { validatePaymentData } = require('../utils/validation.utils');

/**
 * 创建支付意图
 * @route POST /api/payment-intent
 * @access Public
 */
exports.createPaymentIntent = async (req, res) => {
  try {
    const { qrCodeContent, amount, currency, description, walletAddress } = req.body;
    
    // 验证请求数据
    if (!qrCodeContent || !amount || !walletAddress) {
      return res.status(400).json({
        success: false,
        message: '缺少必要参数：二维码内容、金额和钱包地址必须提供'
      });
    }
    
    // 验证钱包地址格式
    if (!/^0x[a-fA-F0-9]{40}$/.test(walletAddress)) {
      return res.status(400).json({
        success: false,
        message: '无效的以太坊钱包地址'
      });
    }
    
    // 解析二维码内容
    const parsedQRData = await parseQRCode(qrCodeContent);
    if (!parsedQRData.success) {
      return res.status(400).json({
        success: false,
        message: '无法解析二维码内容',
        error: parsedQRData.error
      });
    }
    
    // 识别支付平台
    const platformInfo = identifyPaymentPlatform(parsedQRData.data);
    if (!platformInfo.success) {
      return res.status(400).json({
        success: false,
        message: '无法识别支付平台',
        error: platformInfo.error
      });
    }
    
    // 查找或创建用户
    let user = await User.findOne({ where: { walletAddress } });
    if (!user) {
      user = await User.create({
        walletAddress,
        isWalletVerified: true
      });
    }
    
    // 创建支付意图
    const paymentIntent = await PaymentIntent.create({
      amount: parseFloat(amount),
      currency: currency || 'CNY',
      description: description || '通过UnitPay支付',
      platform: platformInfo.platform,
      merchantInfo: {
        id: platformInfo.merchantId || '',
        name: platformInfo.merchantName || '',
        accountId: platformInfo.accountId || '',
        qrCodeContent
      },
      userWalletAddress: walletAddress,
      userId: user.id,
      status: 'created',
      statusHistory: [{
        status: 'created',
        timestamp: new Date(),
        note: '用户创建支付意图'
      }]
    });
    
    // 通过Socket.io通知LP有新的支付意图
    req.io.emit('new_payment_intent', {
      id: paymentIntent.id,
      amount: paymentIntent.amount,
      currency: paymentIntent.currency,
      platform: paymentIntent.platform
    });
    
    // 更新用户交易统计
    await user.updateTransactionStats(0); // 初始金额为0，结算后更新
    
    return res.status(201).json({
      success: true,
      message: '支付意图创建成功',
      data: {
        paymentIntentId: paymentIntent.id,
        status: paymentIntent.status,
        amount: paymentIntent.amount,
        currency: paymentIntent.currency,
        platform: paymentIntent.platform
      }
    });
    
  } catch (error) {
    console.error('创建支付意图失败:', error);
    return res.status(500).json({
      success: false,
      message: '创建支付意图失败',
      error: process.env.NODE_ENV === 'development' ? error.message : '服务器内部错误'
    });
  }
};

/**
 * 获取用户的支付意图列表
 * @route GET /api/payment-intent/user/:walletAddress
 * @access Public
 */
exports.getUserPaymentIntents = async (req, res) => {
  try {
    const { walletAddress } = req.params;
    
    // 验证钱包地址格式
    if (!/^0x[a-fA-F0-9]{40}$/.test(walletAddress)) {
      return res.status(400).json({
        success: false,
        message: '无效的以太坊钱包地址'
      });
    }
    
    // 查询用户的支付意图
    const paymentIntents = await PaymentIntent.findAll({
      where: { userWalletAddress: walletAddress },
      order: [['createdAt', 'DESC']]
    });
    
    return res.status(200).json({
      success: true,
      data: paymentIntents
    });
    
  } catch (error) {
    console.error('获取用户支付意图列表失败:', error);
    return res.status(500).json({
      success: false,
      message: '获取用户支付意图列表失败',
      error: process.env.NODE_ENV === 'development' ? error.message : '服务器内部错误'
    });
  }
};

/**
 * 获取LP的支付意图列表
 * @route GET /api/payment-intent/lp/:walletAddress
 * @access Public
 */
exports.getLPPaymentIntents = async (req, res) => {
  try {
    const { walletAddress } = req.params;
    
    // 验证钱包地址格式
    if (!/^0x[a-fA-F0-9]{40}$/.test(walletAddress)) {
      return res.status(400).json({
        success: false,
        message: '无效的以太坊钱包地址'
      });
    }
    
    // 查询LP的支付意图
    const paymentIntents = await PaymentIntent.findAll({
      where: { lpWalletAddress: walletAddress },
      order: [['createdAt', 'DESC']]
    });
    
    return res.status(200).json({
      success: true,
      data: paymentIntents
    });
    
  } catch (error) {
    console.error('获取LP支付意图列表失败:', error);
    return res.status(500).json({
      success: false,
      message: '获取LP支付意图列表失败',
      error: process.env.NODE_ENV === 'development' ? error.message : '服务器内部错误'
    });
  }
};

/**
 * 获取支付意图详情
 * @route GET /api/payment-intent/:id
 * @access Public
 */
exports.getPaymentIntent = async (req, res) => {
  try {
    const { id } = req.params;
    
    // 查询支付意图
    const paymentIntent = await PaymentIntent.findByPk(id);
    
    if (!paymentIntent) {
      return res.status(404).json({
        success: false,
        message: '支付意图不存在'
      });
    }
    
    return res.status(200).json({
      success: true,
      data: paymentIntent
    });
    
  } catch (error) {
    console.error('获取支付意图详情失败:', error);
    return res.status(500).json({
      success: false,
      message: '获取支付意图详情失败',
      error: process.env.NODE_ENV === 'development' ? error.message : '服务器内部错误'
    });
  }
};

/**
 * 取消支付意图
 * @route PUT /api/payment-intent/:id/cancel
 * @access Public
 */
exports.cancelPaymentIntent = async (req, res) => {
  try {
    const { id } = req.params;
    const { walletAddress } = req.body;
    
    // 验证钱包地址格式
    if (!/^0x[a-fA-F0-9]{40}$/.test(walletAddress)) {
      return res.status(400).json({
        success: false,
        message: '无效的以太坊钱包地址'
      });
    }
    
    // 查询支付意图
    const paymentIntent = await PaymentIntent.findByPk(id);
    
    if (!paymentIntent) {
      return res.status(404).json({
        success: false,
        message: '支付意图不存在'
      });
    }
    
    // 验证用户是否有权限取消
    if (paymentIntent.userWalletAddress !== walletAddress) {
      return res.status(403).json({
        success: false,
        message: '无权取消此支付意图'
      });
    }
    
    // 检查支付意图状态
    if (!['created', 'claimed'].includes(paymentIntent.status)) {
      return res.status(400).json({
        success: false,
        message: `支付意图当前状态为${paymentIntent.status}，无法取消`
      });
    }
    
    // 如果已被LP认领，需要解锁LP额度
    if (paymentIntent.status === 'claimed' && paymentIntent.lpId) {
      const lp = await LP.findByPk(paymentIntent.lpId);
      if (lp) {
        lp.lockedQuota -= paymentIntent.amount;
        lp.availableQuota = lp.totalQuota - lp.lockedQuota;
        await lp.save();
      }
    }
    
    // 更新支付意图状态
    const statusHistory = [...paymentIntent.statusHistory, {
      status: 'cancelled',
      timestamp: new Date(),
      note: `用户 ${walletAddress} 取消支付意图`
    }];
    
    await paymentIntent.update({
      status: 'cancelled',
      statusHistory
    });
    
    // 通过Socket.io通知LP支付意图已取消
    if (paymentIntent.lpWalletAddress) {
      req.io.to(paymentIntent.lpWalletAddress).emit('payment_intent_cancelled', {
        id: paymentIntent.id,
        userWalletAddress: walletAddress
      });
    }
    
    return res.status(200).json({
      success: true,
      message: '支付意图取消成功',
      data: {
        paymentIntentId: paymentIntent.id,
        status: 'cancelled'
      }
    });
    
  } catch (error) {
    console.error('取消支付意图失败:', error);
    return res.status(500).json({
      success: false,
      message: '取消支付意图失败',
      error: process.env.NODE_ENV === 'development' ? error.message : '服务器内部错误'
    });
  }
};

/**
 * 确认支付意图（用户确认已收到付款）
 * @route PUT /api/payment-intent/:id/confirm
 * @access Public
 */
exports.confirmPaymentIntent = async (req, res) => {
  try {
    const { id } = req.params;
    const { walletAddress } = req.body;
    
    // 验证钱包地址格式
    if (!/^0x[a-fA-F0-9]{40}$/.test(walletAddress)) {
      return res.status(400).json({
        success: false,
        message: '无效的以太坊钱包地址'
      });
    }
    
    // 查询支付意图
    const paymentIntent = await PaymentIntent.findByPk(id);
    
    if (!paymentIntent) {
      return res.status(404).json({
        success: false,
        message: '支付意图不存在'
      });
    }
    
    // 验证用户是否有权限确认
    if (paymentIntent.userWalletAddress !== walletAddress) {
      return res.status(403).json({
        success: false,
        message: '无权确认此支付意图'
      });
    }
    
    // 检查支付意图状态
    if (paymentIntent.status !== 'paid') {
      return res.status(400).json({
        success: false,
        message: `支付意图当前状态为${paymentIntent.status}，无法确认`
      });
    }
    
    // 更新支付意图状态
    const statusHistory = [...paymentIntent.statusHistory, {
      status: 'confirmed',
      timestamp: new Date(),
      note: `用户 ${walletAddress} 确认已收到付款`
    }];
    
    await paymentIntent.update({
      status: 'confirmed',
      statusHistory
    });
    
    // 通过Socket.io通知LP支付意图已确认
    req.io.to(paymentIntent.lpWalletAddress).emit('payment_intent_confirmed', {
      id: paymentIntent.id,
      userWalletAddress: walletAddress
    });
    
    // 将任务添加到结算队列
    req.settlementQueue.add({
      paymentIntentId: paymentIntent.id,
      amount: paymentIntent.amount,
      userWalletAddress: paymentIntent.userWalletAddress,
      lpWalletAddress: paymentIntent.lpWalletAddress
    });
    
    return res.status(200).json({
      success: true,
      message: '支付意图确认成功，已加入结算队列',
      data: {
        paymentIntentId: paymentIntent.id,
        status: 'confirmed'
      }
    });
    
  } catch (error) {
    console.error('确认支付意图失败:', error);
    return res.status(500).json({
      success: false,
      message: '确认支付意图失败',
      error: process.env.NODE_ENV === 'development' ? error.message : '服务器内部错误'
    });
  }
};