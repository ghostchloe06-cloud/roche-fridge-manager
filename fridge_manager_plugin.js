(function() {
  "use strict";

  var PLUGIN_ID = "fridge-manager";
  var APP_ID = "fridge-manager-home";
  var ROOT_CLASS = "roche-plugin-fridge-manager";
  var STORAGE_KEY = "fridge_state_v1";
  var DAYS = ["周一", "周二", "周三", "周四", "周五", "周六", "周日"];
  var MEALS = [
    { id: "breakfast", label: "早" },
    { id: "lunch", label: "午" },
    { id: "dinner", label: "晚" }
  ];
  var DEFAULT_CATEGORIES = ["主食", "蛋白质", "蔬菜", "水果", "乳制品", "调味", "饮料", "零食", "未分类"];
  var MEAL_SUB_TABS = ["menu", "shopping", "profile"];
  var DEFAULT_STATE = {
    tab: "inventory",
    mealSubTab: "menu",
    filter: "全部",
    inventory: [],
    menu: [],
    shoppingList: [],
    health: {
      height: "",
      weight: "",
      targetCalories: "",
      goal: "",
      note: ""
    },
    memorySourceIds: [],
    managerCharacterId: "",
    managerStyle: "",
    settings: {
      memoryEnabled: false,
      menuMode: "pantry"
    },
    editingItemId: null,
    busy: false,
    notice: ""
  };

  var ICONS = {
    close: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12"/></svg>',
    plus: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>',
    trash: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 6h18M8 6V4h8v2M6 6l1 15h10l1-15"/></svg>',
    edit: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L8 18l-4 1 1-4Z"/></svg>',
    back: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m15 18-6-6 6-6"/></svg>',
    check: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 6 9 17l-5-5"/></svg>',
    heart: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.6l-1-1a5.5 5.5 0 0 0-7.8 7.8l1 1L12 21l7.8-7.6 1-1a5.5 5.5 0 0 0 0-7.8Z"/></svg>',
    spark: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m12 2 2.3 7.1L22 12l-7.7 2.9L12 22l-2.3-7.1L2 12l7.7-2.9Z"/></svg>',
    refresh: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M21 12a9 9 0 1 1-2.6-6.4"/><path d="M21 3v6h-6"/></svg>',
    list: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/></svg>',
    download: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3v12"/><path d="m7 10 5 5 5-5"/><path d="M5 21h14"/></svg>',
    upload: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 21V9"/><path d="m7 14 5-5 5 5"/><path d="M5 3h14"/></svg>'
  };

  function freshState() {
    var copy = JSON.parse(JSON.stringify(DEFAULT_STATE));
    copy.menu = buildEmptyMenu();
    return copy;
  }

  var state = freshState();
  var runtime = {
    roche: null,
    container: null,
    styleEl: null,
    root: null,
    characters: [],
    conversations: [],
    lastMemoryText: ""
  };

  function buildEmptyMenu() {
    var rows = [];
    for (var d = 0; d < DAYS.length; d++) {
      for (var m = 0; m < MEALS.length; m++) {
        rows.push({
          id: DAYS[d] + "-" + MEALS[m].id,
          day: DAYS[d],
          mealId: MEALS[m].id,
          mealLabel: MEALS[m].label,
          title: "",
          ingredients: [],
          calories: "",
          locked: false,
          note: ""
        });
      }
    }
    return rows;
  }

  function escapeHtml(value) {
    if (value === null || value === undefined) return "";
    return String(value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function id() {
    if (window.crypto && window.crypto.randomUUID) return window.crypto.randomUUID();
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
  }

  function todayIso() {
    return new Date().toISOString().slice(0, 10);
  }

  function itemDaysLeft(item) {
    if (!item.expiryDate) return null;
    var today = new Date(todayIso() + "T00:00:00");
    var exp = new Date(item.expiryDate + "T00:00:00");
    if (Number.isNaN(exp.getTime())) return null;
    return Math.ceil((exp.getTime() - today.getTime()) / 86400000);
  }

  function normalizeState(saved) {
    var next = freshState();
    if (!saved || typeof saved !== "object") return next;
    Object.keys(next).forEach(function(key) {
      if (saved[key] !== undefined) next[key] = saved[key];
    });
    if (!Array.isArray(next.inventory)) next.inventory = [];
    if (!Array.isArray(next.menu) || next.menu.length !== 21) next.menu = buildEmptyMenu();
    if (!Array.isArray(next.shoppingList)) next.shoppingList = [];
    if (!Array.isArray(next.memorySourceIds)) next.memorySourceIds = [];
    if (MEAL_SUB_TABS.indexOf(next.mealSubTab) < 0) next.mealSubTab = "menu";
    next.health = Object.assign({}, DEFAULT_STATE.health, saved.health || {});
    next.settings = Object.assign({}, DEFAULT_STATE.settings, saved.settings || {});
    next.busy = false;
    next.notice = "";
    return next;
  }

  async function loadState(roche) {
    if (!roche || !roche.storage) {
      state = freshState();
      return;
    }
    try {
      var saved = await roche.storage.get(STORAGE_KEY);
      state = normalizeState(saved);
    } catch (error) {
      state = freshState();
      notify("读取插件存储失败，已打开空白冰箱。");
    }
  }

  async function saveState() {
    if (!runtime.roche || !runtime.roche.storage) return;
    var clean = JSON.parse(JSON.stringify(state));
    clean.busy = false;
    clean.notice = "";
    clean.editingItemId = null;
    await runtime.roche.storage.set(STORAGE_KEY, clean);
  }

  var noticeTimer = null;
  function notify(message) {
    state.notice = message;
    if (runtime.roche && runtime.roche.ui && runtime.roche.ui.toast) {
      try { runtime.roche.ui.toast(message); } catch (error) {}
    }
    if (noticeTimer) clearTimeout(noticeTimer);
    noticeTimer = setTimeout(function() {
      noticeTimer = null;
      if (state.notice === message) {
        state.notice = "";
        render(runtime.container);
      }
    }, 2600);
  }

  function inventoryStats() {
    var expiring = 0;
    var low = 0;
    var frozen = 0;
    state.inventory.forEach(function(item) {
      var days = itemDaysLeft(item);
      if (days !== null && days <= 3) expiring++;
      if (Number(item.quantity || 0) <= Number(item.lowStockAt || 0) && Number(item.lowStockAt || 0) > 0) low++;
      if (item.location === "冷冻") frozen++;
    });
    return { expiring: expiring, low: low, frozen: frozen, total: state.inventory.length };
  }

  function categories() {
    var seen = {};
    DEFAULT_CATEGORIES.forEach(function(c) { seen[c] = true; });
    state.inventory.forEach(function(item) {
      if (item.category) seen[item.category] = true;
    });
    return Object.keys(seen);
  }

  function filteredInventory() {
    var list = state.inventory.slice().sort(function(a, b) {
      var ad = itemDaysLeft(a);
      var bd = itemDaysLeft(b);
      if (ad === null) ad = 9999;
      if (bd === null) bd = 9999;
      if (ad !== bd) return ad - bd;
      return String(a.name || "").localeCompare(String(b.name || ""), "zh-Hans-CN");
    });
    if (state.filter === "全部") return list;
    return list.filter(function(item) {
      if (state.filter === "即将到期") {
        var d = itemDaysLeft(item);
        return d !== null && d <= 3;
      }
      if (state.filter === "库存偏低") {
        return Number(item.quantity || 0) <= Number(item.lowStockAt || 0) && Number(item.lowStockAt || 0) > 0;
      }
      return item.category === state.filter || item.location === state.filter;
    });
  }

  function groupedMenu() {
    var result = [];
    DAYS.forEach(function(day) {
      result.push({
        day: day,
        slots: state.menu.filter(function(slot) { return slot.day === day; })
      });
    });
    return result;
  }

  function render(container) {
    if (!container) return;
    runtime.root = container.querySelector("." + ROOT_CLASS);
    if (!runtime.root) return;
    var prevShell = runtime.root.querySelector(".fm-shell");
    var scrollTop = prevShell ? prevShell.scrollTop : 0;
    runtime.root.innerHTML = [
      '<section class="fm-shell">',
        renderHeader(),
        state.notice ? '<div class="fm-notice">' + escapeHtml(state.notice) + '</div>' : "",
        renderTabs(),
        state.tab === "inventory" ? renderInventoryTab() : renderMenuTab(),
      '</section>'
    ].join("");
    var nextShell = runtime.root.querySelector(".fm-shell");
    if (nextShell && scrollTop) nextShell.scrollTop = scrollTop;
  }

  function renderHeader() {
    var stats = inventoryStats();
    return [
      '<header class="fm-header">',
        '<button class="fm-nav-btn" data-action="close" title="返回">' + ICONS.back + '</button>',
        '<div class="fm-title"><h1>我的冰箱</h1><p>FRIDGE</p></div>',
        '<div class="fm-header-actions"></div>',
      '</header>',
      '<section class="fm-summary">',
        '<span>库存 ' + stats.total + '</span>',
        '<span>即将到期 ' + stats.expiring + '</span>',
        '<span>库存偏低 ' + stats.low + '</span>',
        '<span>冷冻 ' + stats.frozen + '</span>',
      '</section>'
    ].join("");
  }

  function renderTabs() {
    return [
      '<nav class="fm-tabs" aria-label="冰箱功能">',
        '<button class="' + (state.tab === "inventory" ? "active" : "") + '" data-tab="inventory">库存</button>',
        '<button class="' + (state.tab === "menu" ? "active" : "") + '" data-tab="menu">本周三餐</button>',
      '</nav>'
    ].join("");
  }

  function renderInventoryTab() {
    return [
      '<div class="fm-grid">',
        '<section class="fm-panel fm-form-panel">',
          '<h2>' + (state.editingItemId ? "编辑食材" : "添加食材") + '</h2>',
          renderItemForm(),
        '</section>',
        '<section class="fm-panel">',
          '<div class="fm-panel-head">',
            '<h2>库存清单</h2>',
            '<button class="fm-ghost-btn" data-action="seed-demo">填入示例</button>',
          '</div>',
          renderFilters(),
          renderInventoryList(),
        '</section>',
      '</div>'
    ].join("");
  }

  function renderItemForm() {
    var item = state.inventory.filter(function(x) { return x.id === state.editingItemId; })[0] || {};
    return [
      '<form class="fm-form" data-form="item">',
        '<input name="name" value="' + escapeHtml(item.name || "") + '" placeholder="食材名，例如：鸡蛋" required>',
        '<div class="fm-form-row">',
          '<input name="quantity" type="number" min="0" step="0.1" value="' + escapeHtml(item.quantity || "") + '" placeholder="数量">',
          '<input name="unit" value="' + escapeHtml(item.unit || "") + '" placeholder="单位">',
        '</div>',
        '<div class="fm-form-row">',
          '<input name="category" value="' + escapeHtml(item.category || "") + '" placeholder="分类，例如：主食">',
          '<select name="location">',
            option("冷藏", item.location || "冷藏"),
            option("冷冻", item.location || "冷藏"),
            option("常温", item.location || "冷藏"),
          '</select>',
        '</div>',
        '<div class="fm-form-row">',
          '<input name="expiryDate" type="date" value="' + escapeHtml(item.expiryDate || "") + '">',
          '<input name="lowStockAt" type="number" min="0" step="0.1" value="' + escapeHtml(item.lowStockAt || "") + '" placeholder="低库存提醒">',
        '</div>',
        '<textarea name="note" rows="2" placeholder="备注，例如：开封后先吃">' + escapeHtml(item.note || "") + '</textarea>',
        '<div class="fm-actions">',
          '<button class="fm-primary" type="submit">' + ICONS.plus + '<span>' + (state.editingItemId ? "保存" : "添加") + '</span></button>',
          state.editingItemId ? '<button class="fm-secondary" type="button" data-action="cancel-edit">取消</button>' : "",
        '</div>',
      '</form>'
    ].join("");
  }

  function option(value, current) {
    return '<option value="' + escapeHtml(value) + '"' + (value === current ? " selected" : "") + '>' + escapeHtml(value) + '</option>';
  }

  function renderFilters() {
    var filters = ["全部", "即将到期", "库存偏低", "冷藏", "冷冻", "常温"].concat(categories());
    var seen = {};
    return '<div class="fm-chips">' + filters.map(function(f) {
      if (seen[f]) return "";
      seen[f] = true;
      return '<button class="' + (state.filter === f ? "active" : "") + '" data-filter="' + escapeHtml(f) + '">' + escapeHtml(f) + '</button>';
    }).join("") + '</div>';
  }

  function renderInventoryList() {
    var list = filteredInventory();
    if (!list.length) return '<div class="fm-empty">还没有库存。先加一点食材，菜单生成会更听话。</div>';
    return '<div class="fm-items">' + list.map(renderInventoryItem).join("") + '</div>';
  }

  function renderInventoryItem(item) {
    var days = itemDaysLeft(item);
    var badge = "";
    if (days !== null) {
      var cls = days < 0 ? "bad" : days <= 3 ? "warn" : "ok";
      badge = '<span class="fm-date-badge ' + cls + '">' + (days < 0 ? "已过期" : days + "天") + '</span>';
    }
    return [
      '<article class="fm-item">',
        '<div class="fm-item-main">',
          badge,
          '<div>',
            '<h3>' + escapeHtml(item.name) + '</h3>',
            '<p>' + escapeHtml([item.quantity ? item.quantity + (item.unit || "") : "", item.location, item.category].filter(Boolean).join(" · ")) + '</p>',
            item.expiryDate ? '<p>到期 ' + escapeHtml(item.expiryDate) + '</p>' : "",
            item.note ? '<p class="fm-muted">' + escapeHtml(item.note) + '</p>' : "",
          '</div>',
        '</div>',
        '<div class="fm-item-actions">',
          '<button data-action="use-item" data-id="' + item.id + '">使用</button>',
          '<button data-action="freeze-item" data-id="' + item.id + '">' + (item.location === "冷冻" ? "取出" : "放冷冻") + '</button>',
          '<button data-action="edit-item" data-id="' + item.id + '">' + ICONS.edit + '</button>',
          '<button class="danger" data-action="delete-item" data-id="' + item.id + '">' + ICONS.trash + '</button>',
        '</div>',
      '</article>'
    ].join("");
  }

  function renderMenuTab() {
    return [
      renderMealSubTabs(),
      state.mealSubTab === "shopping" ? renderShoppingSection() :
      state.mealSubTab === "profile" ? renderProfileSection() :
      renderMenuSection()
    ].join("");
  }

  function renderMealSubTabs() {
    var tabs = [
      { id: "menu", label: "菜单" },
      { id: "shopping", label: "购物清单" },
      { id: "profile", label: "角色与档案" }
    ];
    return '<nav class="fm-subtabs" aria-label="本周三餐子页面">' + tabs.map(function(t) {
      return '<button class="' + (state.mealSubTab === t.id ? "active" : "") + '" data-subtab="' + t.id + '">' + t.label + '</button>';
    }).join("") + '</nav>';
  }

  function renderMenuSection() {
    var mode = state.settings.menuMode === "shopping" ? "shopping" : "pantry";
    var desc = mode === "shopping"
      ? "自由搭配模式：AI 不受库存限制设计菜单，生成后去「购物清单」里看需要采购什么。"
      : "仅用库存模式：AI 只会用现有库存拼菜单，库存不够会在备注里说明，不会凭空加新食材。";
    return [
      '<section class="fm-panel fm-menu-panel">',
        '<div class="fm-panel-head">',
          '<div><h2>本周三餐</h2><p>手填的格子会锁定，留空的格子可由 AI 补齐。' + desc + '</p></div>',
          '<div class="fm-panel-actions">',
            '<button class="fm-secondary" data-action="write-today-memory">' + ICONS.heart + '<span>记住今天</span></button>',
            '<button class="fm-primary" data-action="generate-menu">' + ICONS.spark + '<span>生成空白餐</span></button>',
          '</div>',
        '</div>',
        '<div class="fm-chips">',
          '<button class="' + (mode === "pantry" ? "active" : "") + '" data-action="set-menu-mode" data-id="pantry">仅用库存</button>',
          '<button class="' + (mode === "shopping" ? "active" : "") + '" data-action="set-menu-mode" data-id="shopping">自由搭配+采购</button>',
        '</div>',
        renderMenuGrid(),
      '</section>'
    ].join("");
  }

  function renderShoppingSection() {
    return [
      '<section class="fm-panel">',
        '<div class="fm-panel-head">',
          '<div><h2>购物清单</h2><p>根据本周菜单所需食材和当前库存的差异生成，可手动勾选、删除。</p></div>',
          '<div class="fm-panel-actions">',
            '<button class="fm-ghost-btn" data-action="clear-shopping">清空</button>',
            '<button class="fm-primary" data-action="generate-shopping">' + ICONS.list + '<span>生成购物清单</span></button>',
          '</div>',
        '</div>',
        renderShoppingList(),
      '</section>'
    ].join("");
  }

  function renderProfileSection() {
    return '<div class="fm-grid">' +
      '<section class="fm-panel">' +
        '<h2>健康档案</h2>' +
        renderHealthForm() +
      '</section>' +
      '<section class="fm-panel">' +
        '<h2>角色管理</h2>' +
        renderMemoryPanel() +
      '</section>' +
    '</div>' +
    '<section class="fm-panel">' +
      '<h2>数据备份</h2>' +
      '<p class="fm-muted" style="margin-bottom:14px">导出全部库存、菜单、健康档案和挂载设置为一个 JSON 文件；导入可以还原到之前导出的状态。</p>' +
      '<div class="fm-actions">' +
        '<button class="fm-secondary" data-action="export">' + ICONS.download + '<span>导出备份</span></button>' +
        '<label class="fm-secondary fm-file-btn" style="position:relative">' + ICONS.upload + '<span>导入备份</span><input data-import-backup type="file" accept="application/json"></label>' +
      '</div>' +
    '</section>';
  }

  function renderMenuGrid() {
    return '<div class="fm-menu-list">' + groupedMenu().map(function(group) {
      return [
        '<div class="fm-day-row">',
          '<div class="fm-day-label">' + group.day + '</div>',
          '<div class="fm-meal-cells">',
            group.slots.map(renderMealSlot).join(""),
          '</div>',
        '</div>'
      ].join("");
    }).join("") + '</div>';
  }

  function renderMealSlot(slot) {
    var ingredients = (slot.ingredients || []).join("、");
    return [
      '<article class="fm-meal">',
        '<div class="fm-meal-row">',
          '<span class="fm-meal-label">' + slot.mealLabel + '</span>',
          '<textarea data-menu-title="' + slot.id + '" rows="1" placeholder="留空可生成">' + escapeHtml(slot.title || "") + '</textarea>',
          '<button class="fm-meal-reroll" data-action="reroll-slot" data-id="' + slot.id + '" title="重 roll">' + ICONS.refresh + '</button>',
        '</div>',
        '<input data-menu-note="' + slot.id + '" value="' + escapeHtml(slot.note || "") + '" placeholder="备注/想吃口味">',
        '<p>' + escapeHtml(ingredients || "暂无食材") + (slot.calories ? " · 约" + escapeHtml(slot.calories) : "") + '</p>',
      '</article>'
    ].join("");
  }

  function renderHealthForm() {
    var h = state.health || {};
    return [
      '<form class="fm-form" data-form="health">',
        '<div class="fm-form-row">',
          '<input name="height" value="' + escapeHtml(h.height || "") + '" placeholder="身高，例如 164">',
          '<input name="weight" value="' + escapeHtml(h.weight || "") + '" placeholder="体重，例如 58">',
        '</div>',
        '<div class="fm-form-row">',
          '<input name="targetCalories" value="' + escapeHtml(h.targetCalories || "") + '" placeholder="目标热量，例如 1200">',
          '<input name="goal" value="' + escapeHtml(h.goal || "") + '" placeholder="饮食目标，例如 减脂">',
        '</div>',
        '<input name="note" value="' + escapeHtml(h.note || "") + '" placeholder="其他参考，例如 不要太油、晚餐清淡">',
        '<button class="fm-primary" type="submit">保存</button>',
      '</form>'
    ].join("");
  }

  function renderMemoryPanel() {
    var enabled = state.settings.memoryEnabled;
    var manager = selectedManager();
    var rows = runtime.conversations.slice(0, 60).map(function(conv) {
      var cid = conv.conversationId || conv.id;
      var checked = state.memorySourceIds.indexOf(cid) >= 0;
      var name = conv.title || conv.name || conv.handle || cid;
      return [
        '<label class="fm-memory-row">',
          '<input type="checkbox" data-memory-id="' + escapeHtml(cid) + '"' + (checked ? " checked" : "") + '>',
          '<span>' + escapeHtml(name) + '</span>',
        '</label>'
      ].join("");
    }).join("");
    return [
      '<p class="fm-muted">选择一个 Roche 角色来当三餐管理员。生成菜单时会参考 TA 的人设、语气和对应会话长期记忆。</p>',
      '<div class="fm-actions" style="margin-bottom:10px">',
        '<button class="fm-secondary" data-action="load-characters">刷新角色列表</button>',
      '</div>',
      renderManagerCharList(),
      '<div class="fm-form fm-manager-box">',
        '<textarea data-manager-style rows="2" placeholder="你希望 TA 怎么管你，例如：温柔但严格、少油少糖、晚餐别太重">' + escapeHtml(state.managerStyle || "") + '</textarea>',
      '</div>',
      manager ? '<div class="fm-manager-card"><strong>当前管理员：' + escapeHtml(displayName(manager)) + '</strong><span>' + escapeHtml(manager.bio || manager.description || "会在生成时读取人设作为参考。") + '</span></div>' : "",
      '<label class="fm-toggle"><input type="checkbox" data-toggle-memory' + (enabled ? " checked" : "") + '>生成菜单时读取已勾选会话的长期记忆</label>',
      '<div class="fm-actions">',
        '<button class="fm-secondary" data-action="load-conversations">刷新会话列表</button>',
      '</div>',
      '<div class="fm-memory-list">',
        rows || '<div class="fm-empty small">还没有读取会话列表。可以直接生成菜单，只是不参考记忆偏好。</div>',
      '</div>',
      '<p class="fm-muted">只读取用于提示词参考，不写入 Roche 主记忆。适合放忌口、常吃饭、运动习惯、口味偏好。</p>'
    ].join("");
  }

  function renderManagerCharList() {
    var options = [{ id: "", label: "不指定角色", avatar: "", sub: "生成时不参考特定角色" }].concat(runtime.characters.map(function(char) {
      var name = displayName(char);
      return { id: char.id, label: name, avatar: char.avatar || "", sub: (char.handle && char.handle !== name) ? char.handle : "" };
    }));
    if (options.length === 1) {
      return '<div class="fm-empty small">还没有读取角色列表，点上面「刷新角色列表」试试。</div>';
    }
    return '<div class="fm-char-list">' + options.map(function(opt) {
      var selected = state.managerCharacterId === opt.id;
      var initial = (opt.label || "?").trim().charAt(0) || "?";
      var avatarInner = opt.avatar ? '<img src="' + escapeHtml(opt.avatar) + '" alt="">' : escapeHtml(initial);
      return [
        '<button type="button" class="fm-char-row' + (selected ? " active" : "") + '" data-action="select-manager" data-id="' + escapeHtml(opt.id) + '">',
          '<span class="fm-char-avatar">' + avatarInner + '</span>',
          '<span class="fm-char-info"><strong>' + escapeHtml(opt.label) + '</strong>' + (opt.sub ? '<em>' + escapeHtml(opt.sub) + '</em>' : "") + '</span>',
          selected ? '<span class="fm-char-check">' + ICONS.check + '</span>' : "",
        '</button>'
      ].join("");
    }).join("") + '</div>';
  }

  function renderShoppingList() {
    if (!state.shoppingList.length) return '<div class="fm-empty small">购物清单为空。生成菜单后可以一键整理。</div>';
    return '<div class="fm-shopping">' + state.shoppingList.map(function(item) {
      return [
        '<label class="fm-shop-row ' + (item.done ? "done" : "") + '">',
          '<input type="checkbox" data-shop-done="' + item.id + '"' + (item.done ? " checked" : "") + '>',
          '<span>' + escapeHtml(item.name) + '</span>',
          '<em>' + escapeHtml(item.reason || "") + '</em>',
          '<button data-action="delete-shopping" data-id="' + item.id + '">' + ICONS.trash + '</button>',
        '</label>'
      ].join("");
    }).join("") + '</div>';
  }

  async function handleClick(event) {
    var target = event.target.closest("[data-action], [data-tab], [data-subtab], [data-filter]");
    if (!target || !runtime.root || !runtime.root.contains(target)) return;
    /* 表单控件（checkbox/radio/select/textarea 等）只应由 change 事件驱动，绝不能被这里的
       click 派发逻辑捕获——否则 preventDefault 会取消勾选框的默认行为并连带吃掉 change 事件，
       随后的整页重渲染还会把滚动位置重置到顶部。 */
    var tagName = (target.tagName || "").toUpperCase();
    if (tagName === "INPUT" || tagName === "SELECT" || tagName === "TEXTAREA") return;
    var action = target.getAttribute("data-action");
    var tab = target.getAttribute("data-tab");
    var subtab = target.getAttribute("data-subtab");
    var filter = target.getAttribute("data-filter");
    if (tab) {
      state.tab = tab;
      render(runtime.container);
      saveState();
      return;
    }
    if (subtab) {
      state.mealSubTab = subtab;
      render(runtime.container);
      saveState();
      return;
    }
    if (filter) {
      state.filter = filter;
      render(runtime.container);
      saveState();
      return;
    }
    if (!action) return;
    event.preventDefault();
    var itemId = target.getAttribute("data-id");
    if (action === "close") return closeApp();
    if (action === "cancel-edit") state.editingItemId = null;
    if (action === "seed-demo") seedDemo();
    if (action === "edit-item") state.editingItemId = itemId;
    if (action === "delete-item") await deleteItem(itemId);
    if (action === "use-item") await useItem(itemId);
    if (action === "freeze-item") await toggleFreeze(itemId);
    if (action === "generate-menu") { await generateMenu(); return; }
    if (action === "reroll-slot") { await rerollSlot(itemId); return; }
    if (action === "generate-shopping") await generateShoppingList();
    if (action === "write-today-memory") await writeTodayMealsMemory();
    if (action === "clear-shopping") state.shoppingList = [];
    if (action === "delete-shopping") state.shoppingList = state.shoppingList.filter(function(x) { return x.id !== itemId; });
    if (action === "select-manager") state.managerCharacterId = itemId || "";
    if (action === "set-menu-mode") state.settings.menuMode = itemId === "shopping" ? "shopping" : "pantry";
    if (action === "load-characters") await loadCharacters(false);
    if (action === "load-conversations") await loadConversations();
    if (action === "export") await exportData();
    render(runtime.container);
    await saveState();
  }

  async function handleSubmit(event) {
    var form = event.target.closest("form[data-form]");
    if (!form || !runtime.root || !runtime.root.contains(form)) return;
    event.preventDefault();
    var type = form.getAttribute("data-form");
    var data = formData(form);
    if (type === "item") await saveItem(data);
    if (type === "health") {
      state.health = data;
      notify("健康档案已保存。");
    }
    render(runtime.container);
    await saveState();
  }

  async function handleChange(event) {
    var target = event.target;
    if (!runtime.root || !runtime.root.contains(target)) return;
    if (target.matches("[data-menu-title]")) {
      updateMenuSlot(target.getAttribute("data-menu-title"), { title: target.value, locked: !!target.value.trim() });
      await saveState();
      return;
    }
    if (target.matches("[data-menu-note]")) {
      updateMenuSlot(target.getAttribute("data-menu-note"), { note: target.value });
      await saveState();
      return;
    }
    if (target.matches("[data-shop-done]")) {
      var sid = target.getAttribute("data-shop-done");
      state.shoppingList.forEach(function(item) { if (item.id === sid) item.done = target.checked; });
      await saveState();
      render(runtime.container);
      return;
    }
    if (target.matches("[data-memory-id]")) {
      var mid = target.getAttribute("data-memory-id");
      if (target.checked && state.memorySourceIds.indexOf(mid) < 0) state.memorySourceIds.push(mid);
      if (!target.checked) state.memorySourceIds = state.memorySourceIds.filter(function(x) { return x !== mid; });
      await saveState();
      return;
    }
    if (target.matches("[data-manager-style]")) {
      state.managerStyle = target.value;
      await saveState();
      return;
    }
    if (target.matches('[data-toggle-memory]')) {
      state.settings.memoryEnabled = target.checked;
      await saveState();
      return;
    }
    if (target.matches("[data-import-backup]") && target.files && target.files[0]) {
      await importData(target.files[0]);
      target.value = "";
      render(runtime.container);
    }
  }

  function formData(form) {
    var fd = new FormData(form);
    var data = {};
    fd.forEach(function(value, key) { data[key] = String(value).trim(); });
    return data;
  }

  async function saveItem(data) {
    if (!data.name) return;
    var payload = {
      id: state.editingItemId || id(),
      name: data.name,
      quantity: data.quantity,
      unit: data.unit,
      category: data.category || "未分类",
      location: data.location || "冷藏",
      expiryDate: data.expiryDate,
      lowStockAt: data.lowStockAt,
      note: data.note,
      updatedAt: new Date().toISOString()
    };
    var found = false;
    state.inventory = state.inventory.map(function(item) {
      if (item.id === payload.id) {
        found = true;
        return Object.assign({}, item, payload);
      }
      return item;
    });
    if (!found) state.inventory.unshift(payload);
    state.editingItemId = null;
    notify(found ? "食材已保存。" : "食材已加入冰箱。");
  }

  async function deleteItem(itemId) {
    var item = findInventory(itemId);
    if (!item) return;
    var ok = true;
    if (runtime.roche && runtime.roche.ui && runtime.roche.ui.confirm) {
      ok = await runtime.roche.ui.confirm({ title: "删除食材", message: "确定删除「" + item.name + "」吗？" });
    }
    if (!ok) return;
    state.inventory = state.inventory.filter(function(x) { return x.id !== itemId; });
    if (state.editingItemId === itemId) state.editingItemId = null;
  }

  async function useItem(itemId) {
    var item = findInventory(itemId);
    if (!item) return;
    var q = Number(item.quantity || 0);
    if (q > 1) item.quantity = String(q - 1);
    else if (q === 1) item.quantity = "0";
    item.updatedAt = new Date().toISOString();
    notify("已使用一次「" + item.name + "」。");
  }

  async function toggleFreeze(itemId) {
    var item = findInventory(itemId);
    if (!item) return;
    item.location = item.location === "冷冻" ? "冷藏" : "冷冻";
    item.updatedAt = new Date().toISOString();
  }

  function findInventory(itemId) {
    return state.inventory.filter(function(item) { return item.id === itemId; })[0] || null;
  }

  function updateMenuSlot(slotId, patch) {
    state.menu = state.menu.map(function(slot) {
      if (slot.id === slotId) return Object.assign({}, slot, patch);
      return slot;
    });
  }

  function seedDemo() {
    var sample = [
      ["鸡蛋", "10", "个", "蛋白质", "冷藏"],
      ["青椒", "1", "个", "蔬菜", "冷藏"],
      ["lower carb toast", "12", "片", "主食", "冷冻"],
      ["hoki", "200", "克", "蛋白质", "冷藏"],
      ["三文鱼", "1", "份", "蛋白质", "冷藏"],
      ["鸡胸肉", "600", "克", "蛋白质", "冷藏"]
    ];
    sample.forEach(function(row) {
      state.inventory.unshift({
        id: id(),
        name: row[0],
        quantity: row[1],
        unit: row[2],
        category: row[3],
        location: row[4],
        expiryDate: "",
        lowStockAt: "",
        note: "",
        updatedAt: new Date().toISOString()
      });
    });
    notify("示例库存已加入。");
  }

  async function loadConversations() {
    if (!runtime.roche || !runtime.roche.conversation || !runtime.roche.conversation.list) {
      notify("当前 Roche 没有开放会话列表 API。");
      return;
    }
    try {
      runtime.conversations = await runtime.roche.conversation.list();
      notify("会话列表已刷新。");
    } catch (error) {
      notify("读取会话列表失败。");
    }
  }

  async function loadCharacters(silent) {
    if (!runtime.roche || !runtime.roche.character || !runtime.roche.character.list) {
      if (!silent) notify("当前 Roche 没有开放角色列表 API。");
      return;
    }
    try {
      runtime.characters = await runtime.roche.character.list();
      if (!silent) notify("角色列表已刷新。");
    } catch (error) {
      if (!silent) notify("读取角色列表失败。");
    }
  }

  function displayName(char) {
    if (!char) return "";
    return char.handle || char.name || char.displayName || char.id || "未命名角色";
  }

  function selectedManager() {
    for (var i = 0; i < runtime.characters.length; i++) {
      if (runtime.characters[i].id === state.managerCharacterId) return runtime.characters[i];
    }
    return null;
  }

  async function loadManagerContext() {
    if (!state.managerCharacterId || !runtime.roche || !runtime.roche.character) return "";
    var char = selectedManager();
    try {
      if ((!char || !char.persona) && runtime.roche.character.get) {
        char = await runtime.roche.character.get(state.managerCharacterId);
      }
    } catch (error) {}
    if (!char) return "";
    var lines = [];
    lines.push("三餐管理员角色：" + displayName(char));
    if (char.name) lines.push("正式名：" + char.name);
    if (char.handle) lines.push("昵称：" + char.handle);
    var persona = char.persona || char.bio || char.description || "";
    if (persona) lines.push("角色人设/说话方式：\n" + persona);
    if (state.managerStyle) lines.push("用户希望该角色管理三餐的方式：\n" + state.managerStyle);
    var convId = char.conversationId;
    if (convId && runtime.roche.memory && runtime.roche.memory.getLongTerm) {
      try {
        var memory = await runtime.roche.memory.getLongTerm({ conversationId: convId, limit: 100 });
        var memoryText = memoryToText(memory);
        if (memoryText) lines.push("该角色与用户相关的长期记忆：\n" + memoryText);
      } catch (error) {}
    }
    return lines.join("\n").slice(0, 7000);
  }

  async function loadMemoryText() {
    if (!state.settings.memoryEnabled || !state.memorySourceIds.length) return "";
    if (!runtime.roche || !runtime.roche.memory || !runtime.roche.memory.getLongTerm) return "";
    var parts = [];
    for (var i = 0; i < state.memorySourceIds.length; i++) {
      try {
        var memory = await runtime.roche.memory.getLongTerm({ conversationId: state.memorySourceIds[i], limit: 80 });
        var text = memoryToText(memory);
        if (text) parts.push(text);
      } catch (error) {}
    }
    runtime.lastMemoryText = parts.join("\n\n").slice(0, 6000);
    return runtime.lastMemoryText;
  }

  function memoryToText(memory) {
    var core = memory && memory.core && (memory.core.summary || memory.core.text) || "";
    var facts = (memory && memory.facts || []).map(function(f) {
      return f.summaryText || f.action || f.text || "";
    }).filter(Boolean).join("\n");
    var vectors = (memory && memory.vectors || []).map(function(v) {
      return v.summaryText || v.action || v.text || "";
    }).filter(Boolean).join("\n");
    return [core, facts, vectors].filter(Boolean).join("\n");
  }

  function inventoryPrompt() {
    if (!state.inventory.length) return "当前库存为空。";
    return state.inventory.map(function(item) {
      return "- " + item.name + "：" + [item.quantity ? item.quantity + (item.unit || "") : "", item.location, item.category, item.expiryDate ? "到期 " + item.expiryDate : "", item.note].filter(Boolean).join("，");
    }).join("\n");
  }

  function menuPrompt(slots) {
    return slots.map(function(slot) {
      return "- " + slot.id + "（" + slot.day + slot.mealLabel + "餐）：" + (slot.title ? slot.title : "[留空待生成]") + (slot.note ? "；备注：" + slot.note : "");
    }).join("\n");
  }

  function healthPrompt() {
    var h = state.health || {};
    return [
      h.height ? "身高：" + h.height : "",
      h.weight ? "体重：" + h.weight : "",
      h.targetCalories ? "目标每日热量：" + h.targetCalories : "",
      h.goal ? "饮食目标：" + h.goal : "",
      h.note ? "补充：" + h.note : ""
    ].filter(Boolean).join("；") || "无。";
  }

  async function generateMenu() {
    var targets = state.menu.filter(function(slot) { return !String(slot.title || "").trim(); });
    if (!targets.length) {
      notify("没有空白餐格。想重 roll 某餐，可以点格子右上角按钮。");
      render(runtime.container);
      return;
    }
    await generateSlots(targets);
  }

  async function rerollSlot(slotId) {
    var slot = state.menu.filter(function(x) { return x.id === slotId; })[0];
    if (!slot) return;
    await generateSlots([Object.assign({}, slot, { title: "" })], true);
  }

  async function generateSlots(targets, forceReplace) {
    if (state.busy) {
      notify("上一次生成还没完成，请稍等。");
      render(runtime.container);
      return;
    }
    if (!runtime.roche || !runtime.roche.ai || !runtime.roche.ai.chat) {
      notify("当前 Roche 没有可用 AI 聊天 API。");
      render(runtime.container);
      return;
    }
    state.busy = true;
    state.notice = "正在生成菜单...";
    render(runtime.container);
    try {
      var memoryText = await loadMemoryText();
      var managerContext = await loadManagerContext();
      var targetIds = targets.map(function(s) { return s.id; });
      var system = [
        managerContext ? "你现在扮演用户选择的 Roche 角色来管理用户的三餐。" : "你是一个冰箱库存和本周三餐规划助手。",
        managerContext ? "你要参考角色人设和长期记忆，以该角色会做出的照顾方式来安排菜单；但输出 JSON 字段必须保持客观简洁。" : "",
        state.settings.menuMode === "shopping"
          ? "这次是『自由搭配下周菜单』模式：不必受当前库存限制，可以自由引入库存里没有的新鲜食材，优先考虑营养均衡和口味搭配；生成后用户会根据菜单去采购缺少的食材，不用刻意迁就现有库存。"
          : "这次是『仅用库存』模式：只能使用下面库存列表里已有的食材（盐、油、糖、酱油、醋、葱姜蒜等基础调味料除外），绝不允许引入库存里没有的新食材；如果库存不够做出合理一餐，就用现有库存拼一个简化版本，并在 note 里如实说明库存有限，不能凭空编出库存里没有的食材。临期食材优先安排。",
        "用户手动填写且不在 targetIds 的餐格必须保持不变。",
        "如果有饮食偏好/忌口/习惯记忆，请严格避开忌口，把偏好当作软约束。",
        "健康档案只是软参考，不要做精确医学或营养诊断。",
        "输出必须是 JSON，不要 markdown，不要解释。",
        "JSON 结构：{\"items\":[{\"id\":\"周一-breakfast\",\"title\":\"菜名\",\"ingredients\":[\"食材\"],\"calories\":\"520kcal\",\"note\":\"简短理由\"}]}"
      ].filter(Boolean).join("\n");
      var user = [
        managerContext ? "角色管理上下文：\n" + managerContext : "角色管理上下文：未指定角色。",
        "需要生成或替换的 targetIds：" + JSON.stringify(targetIds),
        "当前库存：\n" + inventoryPrompt(),
        "健康档案：\n" + healthPrompt(),
        memoryText ? "额外挂载的饮食偏好/记忆参考：\n" + memoryText : "额外挂载的饮食偏好/记忆参考：无。",
        "本周菜单现状：\n" + menuPrompt(state.menu),
        forceReplace ? "这次是单格重 roll，请替换 targetIds 中的餐格。" : "只生成空白餐格。"
      ].join("\n\n");
      var result = await runtime.roche.ai.chat({
        messages: [
          { role: "system", content: system },
          { role: "user", content: user }
        ],
        temperature: 0.75
      });
      var parsed = parseJsonLoose(result && result.text ? result.text : result);
      if (!parsed || !Array.isArray(parsed.items)) throw new Error("AI 返回不是可解析菜单 JSON");
      applyGeneratedMenu(parsed.items, targetIds);
      notify("菜单已生成。");
    } catch (error) {
      notify("生成失败：" + (error && error.message ? error.message : "未知错误"));
    } finally {
      state.busy = false;
      await saveState();
      render(runtime.container);
    }
  }

  function applyGeneratedMenu(items, allowedIds) {
    var allow = {};
    allowedIds.forEach(function(x) { allow[x] = true; });
    items.forEach(function(item) {
      if (!item || !allow[item.id]) return;
      updateMenuSlot(item.id, {
        title: String(item.title || "").trim(),
        ingredients: Array.isArray(item.ingredients) ? item.ingredients.map(String).filter(Boolean).slice(0, 12) : [],
        calories: String(item.calories || "").replace(/^约/, ""),
        note: String(item.note || "").trim(),
        locked: false
      });
    });
  }

  async function generateShoppingList() {
    var needed = {};
    state.menu.forEach(function(slot) {
      (slot.ingredients || []).forEach(function(raw) {
        var name = normalizeIngredient(raw);
        if (!name) return;
        needed[name] = needed[name] || { name: name, count: 0, meals: [] };
        needed[name].count++;
        needed[name].meals.push(slot.day + slot.mealLabel);
      });
    });
    var have = {};
    state.inventory.forEach(function(item) {
      if (!item.name) return;
      have[normalizeIngredient(item.name)] = item;
    });
    var rows = [];
    Object.keys(needed).sort().forEach(function(name) {
      if (have[name] && Number(have[name].quantity || 0) > 0) return;
      rows.push({
        id: id(),
        name: needed[name].name,
        reason: "用于 " + needed[name].meals.slice(0, 5).join("、"),
        done: false
      });
    });
    state.shoppingList = rows;
    notify(rows.length ? "购物清单已生成。" : "菜单食材基本都在库存里。");
  }

  async function writeTodayMealsMemory() {
    if (!runtime.roche || !runtime.roche.memory || !runtime.roche.memory.write) {
      notify("当前 Roche 没有开放记忆写入 API。");
      return;
    }
    var manager = selectedManager();
    if (!manager) {
      notify("请先在角色管理里选择一个 char。");
      return;
    }
    var convId = manager.conversationId;
    if (!convId && runtime.roche.character && runtime.roche.character.get) {
      try {
        var full = await runtime.roche.character.get(manager.id);
        convId = full && full.conversationId;
        manager = full || manager;
      } catch (error) {}
    }
    if (!convId) {
      notify("这个角色没有 conversationId，不能写入 TA 的主记忆。");
      return;
    }
    var day = currentDayLabel();
    var todaySlots = state.menu.filter(function(slot) { return slot.day === day && slot.title && slot.title.trim(); });
    if (!todaySlots.length) {
      notify("今天的菜单还没有填写，先填或生成今天的三餐。");
      return;
    }
    var date = todayIso();
    var mealText = todaySlots.map(function(slot) {
      var ing = (slot.ingredients || []).length ? "（食材：" + slot.ingredients.join("、") + "）" : "";
      return slot.mealLabel + "餐：" + slot.title + ing;
    }).join("；");
    var memorySummary = "用户在 " + date + "（" + day + "）的三餐记录/安排是：" + mealText + "。";
    var ok = true;
    if (runtime.roche.ui && runtime.roche.ui.confirm) {
      ok = await runtime.roche.ui.confirm({
        title: "写入主记忆",
        message: "将把下面内容写入「" + displayName(manager) + "」对应会话的 Roche 主 facts 记忆中，卸载插件也不会自动删除：\n\n" + memorySummary + "\n\n确认写入吗？"
      });
    }
    if (!ok) return;
    await runtime.roche.memory.write({
      conversationId: convId,
      summaryText: memorySummary,
      action: memorySummary,
      who: ["用户", displayName(manager)],
      when: date + " " + day,
      where: "我的冰箱插件",
      source: "fridge-manager-plugin"
    });
    notify(displayName(manager) + " 已记住今天的三餐。");
  }

  function currentDayLabel() {
    var idx = new Date().getDay();
    var map = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];
    return map[idx];
  }

  function normalizeIngredient(value) {
    return String(value || "")
      .toLowerCase()
      .replace(/[，,].*$/g, "")
      .replace(/\d+(\.\d+)?\s*(g|kg|克|千克|个|颗|片|份|ml|毫升|升|l)/gi, "")
      .replace(/\s+/g, " ")
      .trim();
  }

  function parseJsonLoose(raw) {
    var text = typeof raw === "string" ? raw : JSON.stringify(raw || "");
    text = text.replace(/<think>[\s\S]*?<\/think>/gi, "").replace(/```json/gi, "").replace(/```/g, "");
    var match = text.match(/\{[\s\S]*\}/);
    if (!match) return null;
    try { return JSON.parse(match[0]); } catch (error) {}
    /* 响应可能被截断（21 格菜单 JSON 偏大），尝试补全缺失的收尾括号再解析一次 */
    var partial = match[0];
    var openBraces = 0, openBrackets = 0, inStr = false, escape = false;
    for (var i = 0; i < partial.length; i++) {
      var ch = partial[i];
      if (escape) { escape = false; continue; }
      if (ch === "\\") { if (inStr) escape = true; continue; }
      if (ch === '"') { inStr = !inStr; continue; }
      if (inStr) continue;
      if (ch === "{") openBraces++; else if (ch === "}") openBraces--;
      else if (ch === "[") openBrackets++; else if (ch === "]") openBrackets--;
    }
    if (inStr) partial += '"';
    while (openBrackets > 0) { partial += "]"; openBrackets--; }
    while (openBraces > 0) { partial += "}"; openBraces--; }
    try { return JSON.parse(partial); } catch (error2) {}
    return null;
  }

  async function exportData() {
    var data = JSON.stringify(normalizeState(state), null, 2);
    var filename = "roche-fridge-backup-" + todayIso() + ".json";
    /* iOS Safari/WKWebView 里 <a download> 点击 blob URL 经常不触发真正的文件下载，
       优先走系统分享面板（Web Share API 支持 files 的场景），失败或不支持时再回退。 */
    try {
      var file = new File([data], filename, { type: "application/json" });
      if (navigator.canShare && navigator.canShare({ files: [file] }) && navigator.share) {
        await navigator.share({ files: [file], title: filename });
        return;
      }
    } catch (error) {
      if (error && error.name === "AbortError") return;
    }
    var blob = new Blob([data], { type: "application/json" });
    var url = URL.createObjectURL(blob);
    var a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    setTimeout(function() { URL.revokeObjectURL(url); }, 1000);
  }

  async function importData(file) {
    try {
      var text = await file.text();
      var parsed = JSON.parse(text);
      state = normalizeState(parsed);
      notify("备份已导入。");
      await saveState();
    } catch (error) {
      notify("导入失败，请确认是插件导出的 JSON。");
    }
  }

  function closeApp() {
    if (runtime.roche && runtime.roche.ui && runtime.roche.ui.closeApp) {
      runtime.roche.ui.closeApp();
    }
  }

  function installStyle() {
    var style = document.createElement("style");
    style.setAttribute("data-roche-plugin", PLUGIN_ID);
    style.textContent = [
      "." + ROOT_CLASS + " *{box-sizing:border-box}",
      "." + ROOT_CLASS + "{display:flex;flex-direction:column;height:100%;max-width:100%;overflow-x:hidden;background:#ffffff;color:#1c1c1e;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI','PingFang SC','Microsoft YaHei',sans-serif}",
      "." + ROOT_CLASS + " button,." + ROOT_CLASS + " input,." + ROOT_CLASS + " textarea,." + ROOT_CLASS + " select{font:inherit}",
      "." + ROOT_CLASS + " button{cursor:pointer;-webkit-tap-highlight-color:transparent}",
      "." + ROOT_CLASS + " svg{width:18px;height:18px;fill:none;stroke:currentColor;stroke-width:2;stroke-linecap:round;stroke-linejoin:round}",
      "." + ROOT_CLASS + " .fm-shell{flex:1;min-height:0;overflow-y:auto;overflow-x:hidden;-webkit-overflow-scrolling:touch;max-width:760px;margin:0 auto;padding:0 0 90px;background:#ffffff;width:100%}",
      "." + ROOT_CLASS + " .fm-header{position:sticky;top:0;z-index:5;height:64px;display:grid;grid-template-columns:40px 1fr 40px;align-items:center;padding:10px 18px;border-bottom:1px solid #ececee;background:rgba(255,255,255,.96);backdrop-filter:blur(18px)}",
      "." + ROOT_CLASS + " .fm-title{text-align:center;min-width:0}",
      "." + ROOT_CLASS + " h1{margin:0;font-size:28px;line-height:1.05;font-weight:700;letter-spacing:0}",
      "." + ROOT_CLASS + " .fm-title p{margin:6px 0 0;color:#9a9a9e;font-size:13px;font-weight:700;letter-spacing:3px}",
      "." + ROOT_CLASS + " h2{margin:0;font-size:20px;line-height:1.25;font-weight:700}",
      "." + ROOT_CLASS + " h3{margin:0 0 5px;font-size:17px;line-height:1.3;font-weight:600}",
      "." + ROOT_CLASS + " p{margin:0}",
      "." + ROOT_CLASS + " .fm-nav-btn,." + ROOT_CLASS + " .fm-icon-btn{width:36px;height:36px;border-radius:999px;border:1px solid #ececee;background:#f7f7f8;display:grid;place-items:center;color:#1c1c1e}",
      "." + ROOT_CLASS + " .fm-header-actions{display:flex;gap:8px;justify-content:flex-end;align-items:center}",
      "." + ROOT_CLASS + " .fm-file-btn{position:relative;overflow:hidden}",
      "." + ROOT_CLASS + " .fm-file-btn input{position:absolute;inset:0;opacity:0;cursor:pointer}",
      "." + ROOT_CLASS + " .fm-summary{display:flex;gap:10px;overflow:auto;padding:18px 18px 0;scrollbar-width:none}",
      "." + ROOT_CLASS + " .fm-summary span{flex:0 0 auto;border:1px solid #ececee;background:#ffffff;border-radius:14px;padding:10px 15px;color:#9a9a9e;font-size:14px;font-weight:700}",
      "." + ROOT_CLASS + " .fm-tabs{display:flex;gap:10px;padding:18px;border-bottom:1px solid #ececee;background:#ffffff}",
      "." + ROOT_CLASS + " .fm-tabs button{border-radius:14px;border:1px solid #d8d8dc;background:#ffffff;padding:11px 20px;color:#9a9a9e;font-weight:600;font-size:14px}",
      "." + ROOT_CLASS + " .fm-tabs button.active{background:#1c1c1e;color:#ffffff;border-color:#1c1c1e}",
      "." + ROOT_CLASS + " .fm-subtabs{display:flex;margin:0 18px 18px;border-radius:14px;overflow:hidden;border:1px solid #d8d8dc}",
      "." + ROOT_CLASS + " .fm-subtabs button{flex:1;text-align:center;padding:11px 6px;font-size:13px;font-weight:500;border:0;background:#ffffff;color:#6e6e73}",
      "." + ROOT_CLASS + " .fm-subtabs button.active{background:#1c1c1e;color:#ffffff;font-weight:600}",
      "." + ROOT_CLASS + " .fm-subtabs button:not(:last-child){border-right:1px solid #d8d8dc}",
      "." + ROOT_CLASS + " .fm-subtabs button.active:not(:last-child){border-right-color:#1c1c1e}",
      "." + ROOT_CLASS + " .fm-grid{display:grid;grid-template-columns:1fr;gap:0;margin:0}",
      "." + ROOT_CLASS + " .fm-panel{border:0;border-bottom:1px solid #ececee;background:#ffffff;border-radius:0;padding:22px 26px;box-shadow:none}",
      "." + ROOT_CLASS + " .fm-form-panel{background:#ffffff}",
      "." + ROOT_CLASS + " .fm-panel-head{display:flex;align-items:flex-start;justify-content:space-between;gap:14px;margin-bottom:18px}",
      "." + ROOT_CLASS + " .fm-panel-head p{margin-top:7px;color:#6e6e73;font-size:14px;line-height:1.5}",
      "." + ROOT_CLASS + " .fm-panel-actions{display:flex;gap:10px;align-items:center;justify-content:flex-end;flex-wrap:wrap}",
      "." + ROOT_CLASS + " .fm-form{display:grid;gap:12px}",
      "." + ROOT_CLASS + " .fm-form-row{display:grid;grid-template-columns:1fr 1fr;gap:12px}",
      "." + ROOT_CLASS + " input,." + ROOT_CLASS + " textarea,." + ROOT_CLASS + " select{width:100%;border:1px solid #d8d8dc;background:#ffffff;border-radius:14px;padding:11px 14px;color:#1c1c1e;outline:none;font-size:14px}",
      "." + ROOT_CLASS + " input[type=checkbox],." + ROOT_CLASS + " input[type=radio]{width:18px;height:18px;flex:0 0 auto;padding:0;border-radius:4px;border:1px solid #d8d8dc;background:#ffffff;accent-color:#1c1c1e}",
      "." + ROOT_CLASS + " input::placeholder,." + ROOT_CLASS + " textarea::placeholder{color:#9a9a9e}",
      "." + ROOT_CLASS + " textarea{resize:vertical;min-height:44px;line-height:1.5}",
      "." + ROOT_CLASS + " input:focus,." + ROOT_CLASS + " textarea:focus,." + ROOT_CLASS + " select:focus{border-color:#1c1c1e}",
      "." + ROOT_CLASS + " .fm-actions{display:flex;flex-wrap:wrap;gap:10px;align-items:center}",
      "." + ROOT_CLASS + " .fm-primary,." + ROOT_CLASS + " .fm-secondary,." + ROOT_CLASS + " .fm-ghost-btn{border-radius:14px;padding:11px 16px;border:1px solid #d8d8dc;display:inline-flex;align-items:center;justify-content:center;gap:6px;white-space:nowrap;font-weight:600;font-size:14px}",
      "." + ROOT_CLASS + " .fm-primary{background:#1c1c1e;color:#ffffff;border-color:#1c1c1e}",
      "." + ROOT_CLASS + " .fm-secondary{background:#ffffff;color:#1c1c1e;border-color:#d8d8dc}",
      "." + ROOT_CLASS + " .fm-ghost-btn{background:#f2f2f7;color:#6e6e73;border-color:#ececee}",
      "." + ROOT_CLASS + " .fm-chips{display:flex;gap:10px;overflow:auto;margin:0 -26px 18px;padding:0 26px;scrollbar-width:none}",
      "." + ROOT_CLASS + " .fm-chips button{flex:0 0 auto;border:1px solid #d8d8dc;background:#ffffff;border-radius:14px;padding:8px 14px;color:#9a9a9e;font-weight:600;font-size:13px}",
      "." + ROOT_CLASS + " .fm-chips button.active{background:#1c1c1e;color:#ffffff;border-color:#1c1c1e}",
      "." + ROOT_CLASS + " .fm-items{display:grid;gap:0;margin:0 -26px}",
      "." + ROOT_CLASS + " .fm-item{display:flex;justify-content:space-between;gap:14px;border:0;border-top:1px solid #ececee;background:#ffffff;border-radius:0;padding:20px 26px}",
      "." + ROOT_CLASS + " .fm-item-main{display:flex;gap:14px;min-width:0}",
      "." + ROOT_CLASS + " .fm-item-main p{color:#6e6e73;font-size:14px;line-height:1.55}",
      "." + ROOT_CLASS + " .fm-item-actions{display:flex;flex-wrap:wrap;gap:10px;justify-content:flex-end;align-items:center}",
      "." + ROOT_CLASS + " .fm-item-actions button{border:0;background:transparent;color:#1c1c1e;padding:4px;font-weight:600}",
      "." + ROOT_CLASS + " .fm-item-actions .danger{color:#b8433c}",
      "." + ROOT_CLASS + " .fm-date-badge{flex:0 0 auto;width:58px;height:58px;border-radius:999px;display:grid;place-items:center;border:1px solid #ececee;background:#f7f7f8;color:#1c1c1e;font-weight:600;font-size:13px}",
      "." + ROOT_CLASS + " .fm-date-badge.warn{background:#1c1c1e;color:#ffffff;border-color:#1c1c1e}",
      "." + ROOT_CLASS + " .fm-date-badge.bad{background:#1c1c1e;color:#ffffff;border-color:#1c1c1e}",
      "." + ROOT_CLASS + " .fm-empty{border:2px dashed #d8d8dc;border-radius:18px;padding:54px 20px;color:#1c1c1e;background:#ffffff;text-align:center;font-weight:600}",
      "." + ROOT_CLASS + " .fm-empty.small{padding:18px;border-width:1px;border-color:#e5e5ea;color:#9a9a9e;font-size:14px;font-weight:600}",
      "." + ROOT_CLASS + " .fm-menu-panel{margin:0}",
      "." + ROOT_CLASS + " .fm-menu-list{display:grid;gap:0;margin:0 -26px}",
      "." + ROOT_CLASS + " .fm-day-row{display:grid;grid-template-columns:72px 1fr;gap:0;align-items:stretch;border-top:1px solid #ececee}",
      "." + ROOT_CLASS + " .fm-day-label{padding:24px 0 0 26px;color:#9a9a9e;font-size:14px;font-weight:600}",
      "." + ROOT_CLASS + " .fm-meal-cells{display:grid;grid-template-columns:1fr;gap:12px;padding:14px 26px 16px 0}",
      "." + ROOT_CLASS + " .fm-meal{background:#ffffff;border:1px solid #ececee;border-radius:18px;padding:14px;min-width:0}",
      "." + ROOT_CLASS + " .fm-meal-row{display:flex;align-items:center;gap:8px;margin-bottom:10px}",
      "." + ROOT_CLASS + " .fm-meal-label{flex:0 0 auto;color:#9a9a9e;font-size:13px;font-weight:600;letter-spacing:1px}",
      "." + ROOT_CLASS + " .fm-meal-reroll{flex:0 0 auto;border:0;background:#1c1c1e;color:#ffffff;border-radius:999px;width:28px;height:28px;display:grid;place-items:center}",
      "." + ROOT_CLASS + " .fm-meal-reroll svg{width:14px;height:14px}",
      "." + ROOT_CLASS + " .fm-meal-row textarea{flex:1;min-width:0;border:0;background:#f2f2f7;border-radius:14px;margin-bottom:0;font-size:14px;font-weight:600;min-height:0}",
      "." + ROOT_CLASS + " .fm-meal input{border:0;background:#ffffff;border-top:1px solid #ececee;border-radius:0;padding:10px 2px;margin-bottom:8px}",
      "." + ROOT_CLASS + " .fm-meal p{color:#6e6e73;font-size:13px;line-height:1.5}",
      "." + ROOT_CLASS + " .fm-toggle{display:flex;align-items:center;gap:10px;margin:14px 0;color:#6e6e73;font-weight:600}",
      "." + ROOT_CLASS + " .fm-memory-list{display:grid;gap:8px;max-height:200px;overflow:auto;margin-top:12px}",
      "." + ROOT_CLASS + " .fm-memory-row{display:flex;align-items:center;gap:10px;background:#ffffff;border:1px solid #ececee;border-radius:14px;padding:12px}",
      "." + ROOT_CLASS + " .fm-char-list{display:flex;flex-direction:column;gap:8px;max-height:280px;overflow-y:auto;margin:12px 0}",
      "." + ROOT_CLASS + " .fm-char-row{display:flex;align-items:center;gap:12px;width:100%;text-align:left;background:#ffffff;border:1px solid #ececee;border-radius:14px;padding:10px 14px;color:#1c1c1e}",
      "." + ROOT_CLASS + " .fm-char-row.active{border-color:#1c1c1e;background:#f7f7f8}",
      "." + ROOT_CLASS + " .fm-char-avatar{flex:0 0 auto;width:40px;height:40px;border-radius:50%;background:#f2f2f7;display:grid;place-items:center;font-weight:600;color:#6e6e73;overflow:hidden}",
      "." + ROOT_CLASS + " .fm-char-avatar img{width:100%;height:100%;object-fit:cover;display:block}",
      "." + ROOT_CLASS + " .fm-char-info{flex:1;min-width:0;display:flex;flex-direction:column;gap:2px}",
      "." + ROOT_CLASS + " .fm-char-info strong{font-size:15px;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}",
      "." + ROOT_CLASS + " .fm-char-info em{font-style:normal;font-size:12.5px;color:#9a9a9e;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}",
      "." + ROOT_CLASS + " .fm-char-check{flex:0 0 auto;width:20px;height:20px;color:#1c1c1e}",
      "." + ROOT_CLASS + " .fm-char-check svg{width:20px;height:20px}",
      "." + ROOT_CLASS + " .fm-manager-box{margin:14px 0}",
      "." + ROOT_CLASS + " .fm-manager-card{display:grid;gap:6px;background:#f7f7f8;border:1px solid #ececee;border-radius:18px;padding:14px;margin:12px 0}",
      "." + ROOT_CLASS + " .fm-manager-card span{color:#6e6e73;font-size:14px;line-height:1.5}",
      "." + ROOT_CLASS + " .fm-shopping{display:grid;gap:8px}",
      "." + ROOT_CLASS + " .fm-shop-row{display:grid;grid-template-columns:auto minmax(100px,1fr) minmax(100px,2fr) auto;gap:10px;align-items:center;background:#ffffff;border:1px solid #ececee;border-radius:14px;padding:12px}",
      "." + ROOT_CLASS + " .fm-shop-row em{font-style:normal;color:#6e6e73;font-size:13px}",
      "." + ROOT_CLASS + " .fm-shop-row button{border:0;background:transparent;color:#1c1c1e}",
      "." + ROOT_CLASS + " .fm-shop-row.done span{text-decoration:line-through;color:#9a9a9e}",
      "." + ROOT_CLASS + " .fm-muted{color:#6e6e73;font-size:14px;line-height:1.6}",
      "." + ROOT_CLASS + " .fm-notice{margin:14px 18px 0;padding:12px 16px;border-radius:14px;background:#1c1c1e;color:#ffffff;font-weight:600}",
      "@media (min-width: 821px){",
      "." + ROOT_CLASS + " .fm-grid{grid-template-columns:1fr 1fr}",
      "." + ROOT_CLASS + " .fm-menu-panel{grid-column:auto}",
      "}",
      "@media (max-width: 620px){",
      "." + ROOT_CLASS + " .fm-header{height:64px;grid-template-columns:40px 1fr 40px;padding:10px 14px}",
      "." + ROOT_CLASS + " .fm-header-actions{gap:4px}",
      "." + ROOT_CLASS + " .fm-title p{font-size:12px}",
      "." + ROOT_CLASS + " h1{font-size:25px}",
      "." + ROOT_CLASS + " .fm-panel{padding:20px 18px}",
      "." + ROOT_CLASS + " .fm-panel-head{display:grid}",
      "." + ROOT_CLASS + " .fm-panel-actions{justify-content:flex-start}",
      "." + ROOT_CLASS + " .fm-form-row{gap:8px}",
      "." + ROOT_CLASS + " .fm-form-row input,." + ROOT_CLASS + " .fm-form-row select{padding-left:10px;padding-right:10px;font-size:13px}",
      "." + ROOT_CLASS + " .fm-chips{margin-left:-18px;margin-right:-18px;padding-left:18px;padding-right:18px}",
      "." + ROOT_CLASS + " .fm-items,." + ROOT_CLASS + " .fm-menu-list{margin-left:-18px;margin-right:-18px}",
      "." + ROOT_CLASS + " .fm-item{display:grid;padding-left:18px;padding-right:18px}",
      "." + ROOT_CLASS + " .fm-day-row{grid-template-columns:58px 1fr}",
      "." + ROOT_CLASS + " .fm-day-label{padding-left:18px}",
      "." + ROOT_CLASS + " .fm-meal-cells{padding-right:18px}",
      "." + ROOT_CLASS + " .fm-shop-row{grid-template-columns:auto 1fr auto}",
      "." + ROOT_CLASS + " .fm-shop-row em{grid-column:2 / -1}",
      "}"
    ].join("\n");
    document.head.appendChild(style);
    runtime.styleEl = style;
  }

  async function mount(container, roche) {
    runtime.roche = roche;
    runtime.container = container;
    installStyle();
    container.innerHTML = '<div class="' + ROOT_CLASS + '"></div>';
    await loadState(roche);
    await loadCharacters(true);
    container.addEventListener("click", handleClick);
    container.addEventListener("submit", handleSubmit);
    container.addEventListener("change", handleChange);
    render(container);
  }

  async function unmount(container) {
    container.removeEventListener("click", handleClick);
    container.removeEventListener("submit", handleSubmit);
    container.removeEventListener("change", handleChange);
    if (noticeTimer) { clearTimeout(noticeTimer); noticeTimer = null; }
    if (runtime.styleEl && runtime.styleEl.parentNode) runtime.styleEl.parentNode.removeChild(runtime.styleEl);
    container.replaceChildren();
    runtime.roche = null;
    runtime.container = null;
    runtime.root = null;
    runtime.styleEl = null;
  }

  if (!window.RochePlugin || !window.RochePlugin.register) {
    console.error("[fridge-manager] window.RochePlugin.register 不可用");
    return;
  }

  window.RochePlugin.register({
    id: PLUGIN_ID,
    name: "我的冰箱",
    version: "1.0.0",
    apps: [
      {
        id: APP_ID,
        name: "我的冰箱",
        icon: "extension",
        iconImage: "",
        mount: mount,
        unmount: unmount
      }
    ]
  });
})();
