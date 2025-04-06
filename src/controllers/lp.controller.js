const { LP, PaymentIntent } = require('../models/mysql');

/**
 * LP注册
 * @route POST /api/lp/register
 * @access Public
 */
exports.registerLP = async (req, res) => {
  try {
    const {
      walletAddress,
      name,
      email,
      supportedPlatforms,
      totalQuota,
      perTransactionQuota
    } = req.body;
    
    // 验证请求数据
    if (!walletAddress || !supportedPlatforms || !totalQuota || !perTransactionQuota) {
      return res.status(400).json({
        success: false,
        message: '缺少必要参数：钱包地址、支持平台、总额度和单笔额度必须提供'
      });
    }
    
    // 验证钱包地址格式
    if (!/^0x[a-fA-F0-9]{40}$/.test(walletAddress)) {
      return res.status(400).json({
        success: false,
        message: '无效的以太坊钱包地址'
      });
    }
    
    // 检查LP是否已存在
    let lp = await LP.findOne({ where: { walletAddress } });
    if (lp) {
      return res.status(400).json({
        success: false,
        message: '该钱包地址已注册为LP'
      });
    }
    
    // 创建新LP
    lp = await LP.create({
      walletAddress,
      name: name || '',
      email: email || '',
      supportedPlatforms: Array.isArray(supportedPlatforms) ? supportedPlatforms : [supportedPlatforms],
      totalQuota: parseFloat(totalQuota),
      availableQuota: parseFloat(totalQuota),
      lockedQuota: 0,
      perTransactionQuota: parseFloat(perTransactionQuota),
      isVerified: true, // MVP阶段简化验证流程
      isActive: true
    });
    
    return res.status(201).json({
      success: true,
      message: 'LP注册成功',
      data: {
        lpId: lp.id,
        walletAddress: lp.walletAddress,
        totalQuota: lp.totalQuota,
        availableQuota: lp.availableQuota,
        perTransactionQuota: lp.perTransactionQuota
      }
    });
    
  } catch (error) {
    console.error('LP注册失败:', error);
    return res.status(500).json({
      success: false,
      message: 'LP注册失败',
      error: process.env.NODE_ENV === 'development' ? error.message : '服务器内部错误'
    });
  }
};

/**
 * 更新LP额度
 * @route PUT /api/lp/quota
 * @access Public
 */
exports.updateQuota = async (req, res) => {
  try {
    const { walletAddress, totalQuota, perTransactionQuota } = req.body;
    
    // 验证请求数据
    if (!walletAddress || (!totalQuota && !perTransactionQuota)) {
      return res.status(400).json({
        success: false,
        message: '缺少必要参数：钱包地址和至少一项额度必须提供'
      });
    }
    
    // 查找LP
    const lp = await LP.findOne({ where: { walletAddress } });
    if (!lp) {
      return res.status(404).json({
        success: false,
        message: '未找到该LP'
      });
    }
    
    // 更新额度
    const updates = {};
    
    if (totalQuota) {
      const newTotalQuota = parseFloat(totalQuota);
      // 确保新总额度不小于已锁定额度
      if (newTotalQuota < lp.lockedQuota) {
        return res.status(400).json({
          success: false,
          message: '新总额度不能小于当前锁定额度'
        });
      }
      updates.totalQuota = newTotalQuota;
      updates.availableQuota = newTotalQuota - lp.lockedQuota;
    }
    
    if (perTransactionQuota) {
      updates.perTransactionQuota = parseFloat(perTransactionQuota);
    }
    
    // 应用更新
    await lp.update(updates);
    
    return res.status(200).json({
      success: true,
      message: 'LP额度更新成功',
      data: {
        lpId: lp.id,
        walletAddress: lp.walletAddress,
        totalQuota: lp.totalQuota,
        availableQuota: lp.availableQuota,
        lockedQuota: lp.lockedQuota,
        perTransactionQuota: lp.perTransactionQuota
      }
    });
    
  } catch (error) {
    console.error('更新LP额度失败:', error);
    return res.status(500).json({
      success: false,
      message: '更新LP额度失败',
      error: process.env.NODE_ENV === 'development' ? error.message : '服务器内部错误'
    });
  }
};

/**
 * 获取LP信息
 * @route GET /api/lp/:walletAddress
 * @access Public
 */
exports.getLP = async (req, res) => {
  try {
    const { walletAddress } = req.params;
    
    // 验证钱包地址格式
    if (!/^0x[a-fA-F0-9]{40}$/.test(walletAddress)) {
      return res.status(400).json({
        success: false,
        message: '无效的以太坊钱包地址'
      });
    }
    
    // 查找LP
    const lp = await LP.findOne({ where: { walletAddress } });
    if (!lp) {
      return res.status(404).json({
        success: false,
        message: '未找到该LP'
      });
    }
    
    return res.status(200).json({
      success: true,
      data: lp
    });
    
  } catch (error) {
    console.error('获取LP信息失败:', error);
    return res.status(500).json({
      success: false,
      message: '获取LP信息失败',
      error: process.env.NODE_ENV === 'development' ? error.message : '服务器内部错误'
    });
  }
};

/**
 * 获取任务池
 * @route GET /api/lp/task-pool
 * @access Public
 */
exports.getTaskPool = async (req, res) => {
  try {
    // 查询所有状态为created的支付意图
    const tasks = await PaymentIntent.findAll({
      where: { status: 'created' },
      order: [['createdAt', 'DESC']]
    });
    
    return res.status(200).json({
      success: true,
      data: tasks
    });
    
  } catch (error) {
    console.error('获取任务池失败:', error);
    return res.status(500).json({
      success: false,
      message: '获取任务池失败',
      error: process.env.NODE_ENV === 'development' ? error.message : '服务器内部错误'
    });
  }
};

/**
 * LP认领任务
 * @route POST /api/lp/task/:id/claim
 * @access Public
 */
exports.claimTask = async (req, res) => {
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
    
    // 查找LP
    const lp = await LP.findOne({ where: { walletAddress } });
    if (!lp) {
      return res.status(404).json({
        success: false,
        message: '未找到该LP'
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
    
    // 检查支付意图状态
    if (paymentIntent.status !== 'created') {
      return res.status(400).json({
        success: false,
        message: `支付意图当前状态为${paymentIntent.status}，无法认领`
      });
    }
    
    // 检查LP是否支持该支付平台
    if (!lp.supportedPlatforms.includes(paymentIntent.platform)) {
      return res.status(400).json({
        success: false,
        message: `LP不支持${paymentIntent.platform}支付平台`
      });
    }
    
    // 检查LP额度
    if (lp.availableQuota < paymentIntent.amount) {
      return res.status(400).json({
        success: false,
        message: '可用额度不足'
      });
    }
    
    if (paymentIntent.amount > lp.perTransactionQuota) {
      return res.status(400).json({
        success: false,
        message: '超出单笔交易额度限制'
      });
    }
    
    // 锁定LP额度
    lp.lockedQuota += paymentIntent.amount;
    lp.availableQuota = lp.totalQuota - lp.lockedQuota;
    await lp.save();
    
    // 更新支付意图状态
    const statusHistory = [...paymentIntent.statusHistory, {
      status: 'claimed',
      timestamp: new Date(),
      note: `LP ${walletAddress} 标记任务已支付`,
      paymentProof: paymentProof || {}
    }];
    
    await paymentIntent.update({
      status: 'paid',
      statusHistory,
      paymentProof: paymentProof || {}
    });
    
    // 通过Socket.io通知用户任务已支付
    req.io.to(paymentIntent.userWalletAddress).emit('payment_intent_paid', {
      id: paymentIntent.id,
      lpWalletAddress: walletAddress,
      paymentProof
    });
    
    return res.status(200).json({
      success: true,
      message: '任务标记为已支付成功',
      data: {
        paymentIntentId: paymentIntent.id,
        status: 'paid'
      }
    });
    
  } catch (error) {
    console.error('标记任务已支付失败:', error);
    return res.status(500).json({
      success: false,
      message: '标记任务已支付失败',
      error: process.env.NODE_ENV === 'development' ? error.message : '服务器内部错误'
    });
  }
};: `LP ${walletAddress} 认领任务`
    }];
    
    await paymentIntent.update({
      status: 'claimed',
      lpWalletAddress: walletAddress,
      lpId: lp.id,
      statusHistory,
      expiresAt: new Date(Date.now() + 30 * 60 * 1000) // 30分钟过期时间
    });
    
    // 通过Socket.io通知用户任务已被认领
    req.io.to(paymentIntent.userWalletAddress).emit('payment_intent_claimed', {
      id: paymentIntent.id,
      lpWalletAddress: lp.walletAddress
    });
    
    return res.status(200).json({
      success: true,
      message: '任务认领成功',
      data: {
        paymentIntentId: paymentIntent.id,
        status: 'claimed',
        expiresAt: paymentIntent.expiresAt
      }
    });
    
  } catch (error) {
    console.error('认领任务失败:', error);
    return res.status(500).json({
      success: false,
      message: '认领任务失败',
      error: process.env.NODE_ENV === 'development' ? error.message : '服务器内部错误'
    });
  }
};

/**
 * LP标记任务已支付
 * @route POST /api/lp/task/:id/mark-paid
 * @access Public
 */
exports.markTaskPaid = async (req, res) => {
  try {
    const { id } = req.params;
    const { walletAddress, paymentProof } = req.body;
    
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
    
    // 验证LP是否有权限标记
    if (paymentIntent.lpWalletAddress !== walletAddress) {
      return res.status(403).json({
        success: false,
        message: '无权标记此支付意图'
      });
    }
    
    // 检查支付意图状态
    if (paymentIntent.status !== 'claimed') {
      return res.status(400).json({
        success: false,
        message: `支付意图当前状态为${paymentIntent.status}，无法标记为已支付`
      });
    }
    
    // 更新支付意图状态
    const statusHistory = [...paymentIntent.statusHistory, {
      status: 'paid',
      timestamp: new Date(),
      note: `LP ${walletAddress} 标记任务已支付`,
      paymentProof: paymentProof || {}
    }];
    
    await paymentIntent.update({
      status: 'paid',
      statusHistory,
      paymentProof: paymentProof || {}
    });
    
    // 通过Socket.io通知用户任务已支付
    req.io.to(paymentIntent.userWalletAddress).emit('payment_intent_paid', {
      id: paymentIntent.id,
      lpWalletAddress: walletAddress,
      paymentProof
    });
    
    return res.status(200).json({
      success: true,
      message: '任务标记为已支付成功',
      data: {
        paymentIntentId: paymentIntent.id,
        status: 'paid'
      }
    });
    
  } catch (error) {
    console.error('标记任务已支付失败:', error);
    return res.status(500).json({
      success: false,
      message: '标记任务已支付失败',
      error: process.env.NODE_ENV === 'development' ? error.message : '服务器内部错误'
    });
  }
};