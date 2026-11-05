"use strict";

const {
  ItemView,
  Plugin,
  PluginSettingTab,
  Setting,
  TFile,
  TFolder,
  setIcon,
} = require("obsidian");

const VIEW_TYPE = "dragon-scroll-home";
const EXCLUDED_FOLDER_NAMES = new Set(["img"]);
const SUMMARY_LIMIT = 68;
const TITLE_LIMIT = 26;

const DEFAULT_SETTINGS = {
  openOnStartup: true,
  hiddenFolders: [],
};

function isHiddenDirectory(path, hiddenFolders = []) {
  return hiddenFolders.some((hidden) => path === hidden || path.startsWith(`${hidden}/`));
}

function clipText(value, limit) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  if (text.length <= limit) return text;

  const head = text.slice(0, limit);
  const sentenceEnd = Math.max(
    head.lastIndexOf("。"),
    head.lastIndexOf("！"),
    head.lastIndexOf("？"),
    head.lastIndexOf("；"),
    head.lastIndexOf("."),
  );

  const cut = sentenceEnd > limit * 0.55 ? head.slice(0, sentenceEnd + 1) : head;
  return `${cut.trim()}…`;
}

function stripMarkdown(value) {
  return String(value || "")
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/~~~[\s\S]*?~~~/g, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/!\[\[[^\]]*\]\]/g, " ")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
    .replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/g, "$2")
    .replace(/\[\[([^\]]+)\]\]/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/<[^>]+>/g, " ")
    .replace(/^\s*>\s?/gm, "")
    .replace(/^\s*[-*+]\s+/gm, "")
    .replace(/^\s*\d+[.)]\s+/gm, "")
    .replace(/[*_~`#|]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function readFrontmatter(content) {
  const match = String(content || "").match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
  if (!match) return { body: content || "", values: {} };

  const values = {};
  for (const line of match[1].split(/\r?\n/)) {
    const keyValue = line.match(/^([A-Za-z0-9_\-\u4e00-\u9fff]+)\s*:\s*(.+)$/);
    if (!keyValue) continue;
    const key = keyValue[1].trim().toLowerCase();
    const rawValue = keyValue[2].trim().replace(/^['"]|['"]$/g, "");
    values[key] = rawValue;
  }

  return {
    body: content.slice(match[0].length),
    values,
  };
}

function extractDescription(content, fallbackTitle) {
  const { body, values } = readFrontmatter(content);
  const provided = values.description || values.summary || values.excerpt || values["摘要"];
  if (provided) return clipText(provided, SUMMARY_LIMIT);

  const hasCode = /```[\s\S]*?```|~~~[\s\S]*?~~~/.test(body);
  const cleaned = body
    .replace(/```[\s\S]*?```/g, "\n\n")
    .replace(/~~~[\s\S]*?~~~/g, "\n\n");

  const blocks = cleaned.split(/\n\s*\n/);
  const headingFallbacks = [];

  for (const rawBlock of blocks) {
    const block = rawBlock.trim();
    if (!block) continue;
    const heading = block.match(/^#{1,6}\s+(.+)$/);
    if (heading) {
      const headingText = stripMarkdown(heading[1]);
      if (headingText && headingText !== fallbackTitle) headingFallbacks.push(headingText);
      continue;
    }
    if (
      block.startsWith("|") ||
      block.startsWith("![") ||
      block.startsWith("> [!" ) ||
      /^-{3,}$/.test(block) ||
      /^<\/?[a-z]/i.test(block)
    ) {
      continue;
    }
    const text = stripMarkdown(block);
    if (text.length >= 16) return clipText(text, SUMMARY_LIMIT);
  }

  if (headingFallbacks.length) {
    return clipText(headingFallbacks.join(" · "), SUMMARY_LIMIT);
  }

  const plain = stripMarkdown(cleaned);
  if (plain.length >= 12) return clipText(plain, SUMMARY_LIMIT);
  if (hasCode) return "此页以代码与操作记录为主。";
  return "此页只留一方空白，待来日添墨。";
}

function extractTitle(file, content) {
  const { values } = readFrontmatter(content);
  return clipText(values.title || file.basename, TITLE_LIMIT);
}

function formatChineseNumber(value) {
  const number = Math.max(0, Number(value) || 0);
  if (number < 10) return ["零", "一", "二", "三", "四", "五", "六", "七", "八", "九"][number];
  if (number >= 10 && number < 20) {
    return `十${number === 10 ? "" : ["", "一", "二", "三", "四", "五", "六", "七", "八", "九"][number - 10]}`;
  }

  const digits = ["零", "一", "二", "三", "四", "五", "六", "七", "八", "九"];
  const units = ["", "十", "百", "千"];
  const parts = String(number)
    .split("")
    .map(Number);

  let output = "";
  let pendingZero = false;
  for (let index = 0; index < parts.length; index += 1) {
    const digit = parts[index];
    const unit = units[parts.length - index - 1];
    if (digit === 0) {
      pendingZero = output.length > 0;
      continue;
    }
    if (pendingZero) output += "零";
    output += `${digits[digit]}${unit}`;
    pendingZero = false;
  }
  return output || "零";
}

function splitFolderName(name) {
  const match = name.match(/^(\d{1,3})\s+[·._-]?\s*(.+)$/);
  if (!match) return { index: "", label: name };
  return { index: match[1], label: match[2] };
}

function createElement(tag, className, text) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text !== undefined) element.textContent = text;
  return element;
}

class DragonScrollHomeView extends ItemView {
  constructor(leaf, plugin) {
    super(leaf);
    this.plugin = plugin;
    this.groups = [];
    this.sections = [];
    this.generation = 0;
    this.searchQuery = "";
    this.suppressNextPageClick = false;
    this.dragState = null;
    this.expandedChildren = new Map();
    this.searchClosedChildren = new Set();
    this.touchPagePath = "";
    this.instanceId = `ll-${Math.random().toString(36).slice(2, 9)}`;
  }

  getViewType() {
    return VIEW_TYPE;
  }

  getDisplayText() {
    return "龙鳞首页";
  }

  getIcon() {
    return "scroll-text";
  }

  async onOpen() {
    this.contentEl.classList.add("dragon-scroll-home");
    this.addAction("refresh-cw", "重整书卷", () => this.refresh());
    await this.render();
  }

  async onClose() {
    this.generation += 1;
    this.contentEl.empty();
  }

  async refresh(force = false) {
    if (force) this.plugin.clearSummaryCache();
    await this.render();
  }

  showSkeleton() {
    this.contentEl.empty();
    const shell = createElement("main", "ll-shell");
    const loading = createElement("section", "ll-loading");
    const seal = createElement("div", "ll-loading-seal", "鳞");
    const title = createElement("p", "ll-loading-title", "正在理卷");
    const line = createElement("span", "ll-loading-line");
    loading.append(seal, title, line);
    shell.append(loading);
    this.contentEl.append(shell);
  }

  async render() {
    const generation = ++this.generation;
    this.showSkeleton();
    let groups;
    try {
      groups = await this.collectGroups();
    } catch (error) {
      console.error("[龙鳞首页] 无法读取书卷", error);
      if (generation !== this.generation) return;
      this.renderError(error);
      return;
    }
    if (generation !== this.generation) return;
    this.groups = groups;
    this.sections = groups.flatMap((group) => group.sections);
    this.renderHome(groups);
  }

  renderError(error) {
    this.contentEl.empty();
    const shell = createElement("main", "ll-shell");
    const panel = createElement("section", "ll-error");
    panel.append(
      createElement("p", "ll-kicker", "卷册暂未展开"),
      createElement("h1", "", "理卷时遇到一点阻碍"),
      createElement("p", "ll-error-copy", String(error?.message || error)),
    );
    const retry = createElement("button", "ll-retry", "重新理卷");
    retry.type = "button";
    retry.addEventListener("click", () => this.refresh(true));
    panel.append(retry);
    shell.append(panel);
    this.contentEl.append(shell);
  }

  async collectGroups() {
    const root = this.app.vault.getRoot();
    const folderNodes = root.children
      .filter((node) => node instanceof TFolder)
      .filter((folder) => !folder.name.startsWith("."))
      .filter((folder) => !isHiddenDirectory(folder.path, this.plugin.settings?.hiddenFolders))
      .filter((folder) => !EXCLUDED_FOLDER_NAMES.has(folder.name.toLowerCase()));
    folderNodes.sort((left, right) =>
      left.name.localeCompare(right.name, "zh-CN", { numeric: true, sensitivity: "base" }),
    );
    const groups = [];
    for (const folder of folderNodes) {
      const displayName = splitFolderName(folder.name);
      const group = {
        path: folder.path,
        name: folder.name,
        label: displayName.label,
        index: displayName.index,
        sections: [],
        pageCount: 0,
        lastModified: folder.stat?.mtime || 0,
      };

      group.root = await this.collectDirectorySections(folder, group, 0);

      group.pageCount = group.sections.reduce((total, section) => total + section.pages.length, 0);
      group.lastModified = group.sections.reduce(
        (latest, section) => Math.max(latest, section.lastModified),
        group.lastModified,
      );
      groups.push(group);
    }
    let scrollIndex = 0;
    groups.forEach((group) => {
      group.sections.forEach((section) => {
        section.scrollIndex = scrollIndex;
        scrollIndex += 1;
      });
    });
    return groups;
  }

  childFolders(folder) {
    return folder.children.filter((child) => child instanceof TFolder)
      .filter((child) => !child.name.startsWith(".") && !EXCLUDED_FOLDER_NAMES.has(child.name.toLowerCase()))
      .filter((child) => !isHiddenDirectory(child.path, this.plugin.settings?.hiddenFolders))
      .sort((a, b) => a.name.localeCompare(b.name, "zh-CN", { numeric: true, sensitivity: "base" }));
  }

  async collectDirectorySections(folder, group, depth) {
    const files = folder.children.filter((child) => child instanceof TFile && child.extension === "md");
    const section = await this.createSection(folder, group, depth, files);
    section.children = [];
    group.sections.push(section);
    for (const child of this.childFolders(folder)) {
      if (depth < 2) section.children.push(await this.collectDirectorySections(child, group, depth + 1));
      else await this.collectOverflowPages(child, group, section);
    }
    section.pages.sort((a, b) => b.modified - a.modified);
    section.pageCount = section.pages.length + section.children.reduce((sum, child) => sum + child.pageCount, 0);
    section.lastModified = Math.max(section.lastModified, section.pages[0]?.modified || 0);
    return section;
  }

  async collectOverflowPages(folder, group, target) {
    const files = folder.children.filter((child) => child instanceof TFile && child.extension === "md");
    const overflow = await this.createSection(folder, group, 2, files);
    for (const page of overflow.pages) {
      page.originLabel = folder.path.slice(target.path.length + 1);
      target.pages.push(page);
    }
    for (const child of this.childFolders(folder)) await this.collectOverflowPages(child, group, target);
  }

  get query() { return String(this.searchQuery || "").trim().toLowerCase(); }

  pageMatches(page, section) {
    return !this.query || `${section.name} ${page.title} ${page.summary} ${page.path}`.toLowerCase().includes(this.query);
  }

  matchCount(section) {
    return section.pages.filter((page) => this.pageMatches(page, section)).length
      + section.children.reduce((sum, child) => sum + this.matchCount(child), 0);
  }

  nodeMatches(section) {
    return !this.query || this.matchCount(section) > 0 || `${section.name} ${section.path}`.toLowerCase().includes(this.query)
      || section.children.some((child) => this.nodeMatches(child));
  }

  async createSection(folder, group, depth, files) {
    const pages = [];
    for (const file of files) {
      const content = await this.app.vault.cachedRead(file);
      const summaryCacheKey = `${file.path}:${file.stat.mtime}:${file.stat.size}`;
      let summary = this.plugin.summaryCache.get(summaryCacheKey);
      if (!summary) {
        summary = file.name.endsWith(".excalidraw.md") || content.includes("Switch to EXCALIDRAW VIEW")
          ? "Excalidraw 画布，点开查看图形与标注。"
          : extractDescription(content, file.basename);
        this.plugin.summaryCache.set(summaryCacheKey, summary);
      }

      const cleanTitle = extractTitle(file, content).replace(/\.excalidraw$/i, "");
      pages.push({
        path: file.path,
        title: cleanTitle,
        summary,
        folderPath: folder.path,
        modified: file.stat.mtime,
      });
    }
    const displayName = splitFolderName(folder.name);
    const relativeParent = folder.parent?.path === group.path
      ? group.label
      : `${group.label} / ${folder.parent?.path.slice(group.path.length + 1) || ""}`;
    return {
      path: folder.path,
      name: folder.name,
      label: displayName.label,
      index: displayName.index,
      depth,
      rootPath: group.path,
      rootLabel: group.label,
      breadcrumb: depth === 0 ? `${group.label} · 根卷` : relativeParent,
      pages,
      lastModified: files[0]?.stat.mtime || folder.stat?.mtime || 0,
    };
  }

  renderHome(groups) {
    this.contentEl.empty();
    const sections = this.sections;
    const pageCount = sections.reduce((total, section) => total + section.pages.length, 0);
    const shell = createElement("main", "ll-shell");
    shell.style.setProperty("--ll-sections", String(groups.length));
    const hero = this.buildHero(groups, pageCount, sections.length);
    const index = this.buildVolumeIndex(groups);
    const gallery = createElement("section", "ll-gallery");
    gallery.setAttribute("aria-label", "全部书卷");
    if (!groups.length) {
      const empty = createElement("div", "ll-empty-library");
      empty.append(
        createElement("span", "ll-empty-glyph", "卷"),
        createElement("h2", "", "书架尚空"),
        createElement("p", "", "可在插件设置中开启要展示的目录。"),
      );
      gallery.append(empty);
    }
    const footer = createElement("footer", "ll-footer");
    footer.append(
      createElement("span", "ll-footer-mark", "龙鳞装"),
      createElement("p", "", "页页相衔，如鳞覆卷。悬停展页，点页阅文。"),
      createElement("span", "ll-footer-rule"),
    );
    shell.append(hero, index, gallery, footer);
    this.contentEl.append(shell);
    this.attachInteractions(shell);
    this.applySearch(this.searchQuery);
  }

  buildHero(groups, pageCount, scrollCount) {
    const hero = createElement("header", "ll-hero");
    const top = createElement("div", "ll-hero-top");
    const identity = createElement("div", "ll-identity");
    const kicker = createElement("p", "ll-kicker");
    kicker.append(
      createElement("span", "ll-kicker-rule"),
      createElement("span", "", "私家书藏"),
    );
    const titleRow = createElement("div", "ll-title-row");
    const title = createElement("h1", "ll-title", "万卷");
    const titleAside = createElement("div", "ll-title-aside");
    titleAside.append(
      createElement("span", "", "龙鳞装 · 私人书库"),
      createElement("span", "ll-title-aside-en", "卷舒之间，皆是所记"),
    );
    titleRow.append(title, titleAside);
    const intro = createElement(
      "p",
      "ll-intro",
      "一目录成一卷，左轴舒纸。卷中有卷，点签展开；页页相衔，静待展读。",
    );
    identity.append(kicker, titleRow, intro);
    const sealWrap = createElement("div", "ll-seal-wrap");
    const seal = createElement("div", "ll-seal");
    seal.append(
      createElement("span", "", "龙"),
      createElement("span", "", "鳞"),
      createElement("i", "ll-seal-thread"),
    );
    sealWrap.append(seal);
    top.append(identity, sealWrap);
    const stats = createElement("div", "ll-stats");
    const statData = [
      [formatChineseNumber(groups.length), "门", "根目录"],
      [formatChineseNumber(Math.max(0, scrollCount - groups.length)), "卷", "可展开子卷"],
      [formatChineseNumber(pageCount), "页", "笔记书页"],
    ];
    statData.forEach(([number, unit, label]) => {
      const item = createElement("div", "ll-stat");
      const value = createElement("span", "ll-stat-value", number);
      value.append(createElement("small", "", unit));
      item.append(value, createElement("span", "ll-stat-label", label));
      stats.append(item);
    });
    const searchRow = createElement("div", "ll-search-row");
    const searchWrap = createElement("label", "ll-search");
    const searchIcon = createElement("span", "ll-search-icon");
    setIcon(searchIcon, "search");
    const input = createElement("input", "ll-search-input");
    input.type = "search";
    input.placeholder = "寻一卷，或寻一页字…";
    input.setAttribute("aria-label", "搜索书卷、书页与摘要");
    input.autocomplete = "off";
    input.spellcheck = false;
    const clear = createElement("button", "ll-search-clear", "清");
    clear.type = "button";
    clear.setAttribute("aria-label", "清空搜索");
    const searchHint = createElement("p", "ll-search-hint", "墨迹未干 · 共收 {count} 页".replace("{count}", pageCount));
    searchWrap.append(searchIcon, input, clear);
    searchRow.append(searchWrap, searchHint);
    const heroBottom = createElement("div", "ll-hero-bottom");
    heroBottom.append(stats, searchRow);
    const cloudBand = createElement("div", "ll-cloud-band");
    cloudBand.setAttribute("aria-hidden", "true");
    for (let index = 0; index < 5; index += 1) {
      cloudBand.append(createElement("span", "ll-cloud"));
    }
    hero.append(top, cloudBand, heroBottom);
    return hero;
  }

  buildVolumeIndex(groups) {
    const nav = createElement("nav", "ll-index");
    nav.setAttribute("aria-label", "卷目");
    const label = createElement("span", "ll-index-label", "卷目");
    const list = createElement("div", "ll-index-list");
    groups.forEach((group, index) => {
      const button = createElement("button", "ll-index-item");
      button.type = "button";
      button.dataset.target = `${this.instanceId}-root-${index}`;
      button.dataset.volumeKey = group.path;
      const number = createElement("span", "ll-index-number", group.index || String(index + 1).padStart(2, "0"));
      const name = createElement("span", "ll-index-name", group.label);
      const count = createElement("span", "ll-index-count", String(group.pageCount));
      button.append(number, name, count);
      list.append(button);
    });
    nav.append(label, list);
    return nav;
  }

  buildRootGroup(group, index) {
    const root = createElement("section", "ll-root-group is-single");
    root.id = `${this.instanceId}-root-${index}`;
    root.dataset.rootKey = group.path;
    root.hidden = !this.nodeMatches(group.root);
    root.append(this.buildRoll(group.root, group));
    return root;
  }

  buildRoll(section, group, onClose = null) {
    const article = createElement("article", "ll-volume");
    article.id = `${this.instanceId}-volume-${section.scrollIndex}`;
    article.style.setProperty("--ll-roll-order", String(Math.min(section.scrollIndex, 12)));
    article.dataset.volumeKey = section.path;
    article.dataset.depth = String(section.depth);
    const heading = createElement("div", "ll-volume-head");
    const nameBlock = createElement("div", "ll-volume-name");
    const mark = createElement(
      "span",
      "ll-volume-mark",
      section.index || String(section.scrollIndex + 1).padStart(2, "0"),
    );
    const nameCopy = createElement("div", "ll-volume-name-copy");
    nameCopy.append(
      createElement("span", "ll-volume-kicker", section.breadcrumb),
      createElement("h2", "", section.label),
    );
    nameBlock.append(mark, nameCopy);
    const meta = createElement("div", "ll-volume-meta");
    meta.append(
      createElement("span", "ll-volume-count", `${section.pageCount} 页${section.children.length ? ` / ${section.children.length} 子卷` : ""}`),
      createElement("span", "ll-volume-slash", "/"),
      createElement("span", "ll-volume-path", section.path),
    );
    heading.append(nameBlock, meta);
    const frame = createElement("div", "ll-scroll-frame");
    const spindle = createElement("span", "ll-spindle");
    spindle.setAttribute("aria-hidden", "true");
    const tag = createElement(onClose ? "button" : "span", `ll-scroll-tag${onClose ? " ll-close-name" : ""}`);
    tag.title = onClose ? `${section.path}（点击收起）` : section.path;
    tag.append(createElement("span", "ll-scroll-tag-name", section.name));
    if (onClose) {
      const closeHead = createElement("button", "ll-close-head");
      closeHead.type = tag.type = "button";
      closeHead.setAttribute("aria-label", `收起子卷：${section.name}（卷头）`);
      closeHead.title = "点击卷头收起此卷";
      tag.setAttribute("aria-label", `收起子卷：${section.name}（卷名）`);
      closeHead.onclick = tag.onclick = (event) => { event.stopPropagation(); onClose(); };
      frame.append(closeHead);
    }
    const body = createElement("div", "ll-scroll-body");
    const track = createElement("div", "ll-scroll-track");
    track.tabIndex = 0;
    track.setAttribute("aria-label", `${section.name}卷，可横向滚动`);
    const pages = createElement("div", "ll-pages");
    const visible = section.pages.filter((page) => this.pageMatches(page, section));
    for (const [index, page] of visible.entries()) pages.append(this.buildPage(page, section, index));
    const children = section.children.filter((child) => this.nodeMatches(child));
    if (!visible.length && !children.length) {
      const empty = createElement("div", "ll-empty-roll");
      empty.append(createElement("p", "", "此卷暂无 Markdown 书页。"));
      pages.append(empty);
    }
    article.classList.toggle("is-container-only", !visible.length);
    const entries = [];
    for (const [index, child] of children.entries()) {
      const slot = createElement("div", "ll-child-slot");
      slot.style.setProperty("--ll-page-z", String(1000 - visible.length - index));
      const panel = createElement("div", "ll-inline-panel");
      panel.id = `${this.instanceId}-sub-${child.scrollIndex}`;
      panel.hidden = true;
      const button = createElement("button", "ll-child-button");
      button.type = "button";
      button.dataset.childPath = child.path;
      button.setAttribute("title", child.path);
      button.setAttribute("aria-controls", panel.id);
      const copy = createElement("span", "ll-child-copy");
      copy.append(createElement("span", "ll-child-name", child.name), createElement("span", "ll-child-count", `${child.pageCount} 页`));
      button.append(copy, createElement("span", "ll-child-toggle", "展"));
      // The revealed scroll precedes its title, so its contents occupy the LEFT side.
      slot.append(panel, button);
      pages.append(slot);
      entries.push({ child, slot, panel, button });
    }
    const update = (clicked) => {
      for (const { child, slot, panel, button } of entries) {
        const expanded = this.query ? !this.searchClosedChildren.has(child.path) : this.expandedChildren.get(section.path) === child.path;
        button.setAttribute("aria-expanded", String(expanded));
        button.setAttribute("aria-label", `${expanded ? "收起" : "展开"}子卷：${child.name}`);
        button.classList.toggle("is-expanded", expanded);
        slot.classList.toggle("is-expanded", expanded);
        button.querySelector(".ll-child-toggle").textContent = expanded ? "收" : "展";
        panel.hidden = !expanded;
        if (expanded && !panel.firstElementChild) panel.append(this.buildRoll(child, group, () => {
          if (this.suppressNextPageClick) return;
          if (this.query) this.searchClosedChildren.add(child.path);
          else this.expandedChildren.delete(section.path);
          this.touchPagePath = "";
          update();
          button.focus({ preventScroll: true });
        }));
        if (!expanded) panel.replaceChildren();
      }
      if (clicked) {
        // Bring the newly revealed paper into view rather than leaving it outside the track.
        const slot = entries.find((entry) => entry.child.path === clicked)?.slot;
        if (slot?.classList.contains("is-expanded")) window.requestAnimationFrame(() => {
          if (!slot.isConnected) return;
          const delta = slot.getBoundingClientRect().left - track.getBoundingClientRect().left;
          track.scrollBy({ left: delta - 6, behavior: "auto" });
        });
      }
    };
    for (const { child, button } of entries) button.onclick = () => {
      if (this.suppressNextPageClick) return;
      if (this.query) {
        if (this.searchClosedChildren.has(child.path)) this.searchClosedChildren.delete(child.path);
        else this.searchClosedChildren.add(child.path);
      } else if (this.expandedChildren.get(section.path) === child.path) this.expandedChildren.delete(section.path);
      else this.expandedChildren.set(section.path, child.path);
      this.touchPagePath = "";
      update(child.path);
    };
    track.append(pages);
    body.append(track);
    update();
    frame.append(spindle, tag, body);
    article.append(heading, frame);
    this.attachDragToScroll(track);
    return article;
  }

  buildPage(page, section, index) {
    const shell = createElement("div", "ll-page-shell");
    shell.style.setProperty("--ll-page-order", String(Math.min(index, 12)));
    shell.style.setProperty("--ll-page-z", String(1000 - index));
    const button = createElement("button", "ll-page");
    button.type = "button";
    button.dataset.path = page.path;
    button.setAttribute("aria-label", `${page.title}。${page.summary}`);
    button.setAttribute("title", page.title);
    const title = createElement("span", "ll-page-title", page.title);
    const reveal = createElement("span", "ll-page-reveal");
    const summary = createElement("span", "ll-page-summary", page.summary);
    reveal.append(summary);
    if (page.originLabel) reveal.append(createElement("span", "ll-page-origin", page.originLabel));
    button.append(title, reveal);
    button.addEventListener("click", (event) => {
      if (this.suppressNextPageClick) return;
      if (window.matchMedia?.("(hover: none)").matches && this.touchPagePath !== page.path) {
        this.contentEl.querySelectorAll(".is-open-page").forEach((el) => el.classList.remove("is-open-page"));
        this.touchPagePath = page.path;
        shell.classList.add("is-open-page");
        return;
      }
      void this.openPage(page.path, event);
    });
    button.addEventListener("dragstart", (event) => event.preventDefault());
    shell.append(button);
    return shell;
  }

  attachInteractions(shell) {
    const input = shell.querySelector(".ll-search-input");
    const clear = shell.querySelector(".ll-search-clear");
    input?.addEventListener("input", () => {
      this.applySearch(input.value);
    });
    input?.addEventListener("keydown", (event) => {
      if (event.key === "Escape") {
        input.value = "";
        this.applySearch("");
        input.blur();
      }
    });
    clear?.addEventListener("click", () => {
      if (!input) return;
      input.value = "";
      this.applySearch("");
      input.focus();
    });
    shell.querySelectorAll(".ll-index-item").forEach((button) => {
      button.addEventListener("click", () => {
        const target = document.getElementById(button.dataset.target);
        target?.scrollIntoView({ behavior: "smooth", block: "start" });
      });
    });
    shell.addEventListener("pointerdown", (event) => {
      if (!event.target.closest(".ll-page-shell")) {
        this.touchPagePath = "";
        shell.querySelectorAll(".is-open-page").forEach((el) => el.classList.remove("is-open-page"));
        if (document.activeElement?.matches(".ll-page")) document.activeElement.blur();
      }
    });
  }

  attachDragToScroll(track) {
    let drag = null;
    track.addEventListener("pointerdown", (event) => {
      if (event.pointerType !== "mouse" || event.button !== 0 || event.target.closest(".ll-scroll-track") !== track) return;
      drag = { id: event.pointerId, x: event.clientX, left: track.scrollLeft, moved: false };
    });
    track.addEventListener("pointermove", (event) => {
      if (!drag || drag.id !== event.pointerId) return;
      const distance = event.clientX - drag.x;
      if (Math.abs(distance) < 7 && !drag.moved) return;
      drag.moved = true;
      track.classList.add("is-dragging");
      track.scrollLeft = drag.left - distance;
      event.preventDefault();
    });
    const endDrag = () => {
      if (drag?.moved) {
        this.suppressNextPageClick = true;
        window.setTimeout(() => { this.suppressNextPageClick = false; }, 150);
      }
      track.classList.remove("is-dragging");
      drag = null;
    };
    track.addEventListener("pointerup", endDrag);
    track.addEventListener("pointercancel", endDrag);
    track.addEventListener("pointerleave", endDrag);
  }

  applySearch(rawQuery) {
    if (String(rawQuery || "") !== this.searchQuery) this.searchClosedChildren.clear();
    this.searchQuery = String(rawQuery || "");
    const shell = this.contentEl.querySelector(".ll-shell");
    if (!shell) return;
    const gallery = shell.querySelector(".ll-gallery");
    if (!this.groups.length) return;
    gallery.replaceChildren();
    let count = 0;
    this.groups.forEach((group, index) => {
      const matched = this.nodeMatches(group.root);
      const root = this.buildRootGroup(group, index);
      gallery.append(root);
      const item = [...shell.querySelectorAll(".ll-index-item")].find((button) => button.dataset.volumeKey === group.path);
      if (item) item.hidden = !matched;
      if (matched) count += this.matchCount(group.root);
    });
    const hint = shell.querySelector(".ll-search-hint");
    if (hint) hint.textContent = this.query ? `寻得 ${count} 页` : `墨迹未干 · 共收 ${this.totalPages()} 页`;
    if (this.query && !this.groups.some((group) => this.nodeMatches(group.root))) {
      const empty = createElement("div", "ll-no-results");
      empty.append(createElement("span", "ll-no-results-glyph", "寻"), createElement("p", "", "未寻得这页字。换个词，或收起检索。"));
      gallery.append(empty);
    }
  }

  totalPages() {
    return this.sections.reduce((total, section) => total + section.pages.length, 0);
  }

  async openPage(path, event) {
    const file = this.app.vault.getAbstractFileByPath(path);
    if (!(file instanceof TFile)) return;
    const leaf = this.app.workspace.getLeaf(event?.altKey ? "split" : "tab");
    await leaf.openFile(file);
  }
}

class DragonScrollHomeSettingTab extends PluginSettingTab {
  constructor(app, plugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display() {
    const { containerEl } = this;
    const expanded = new Set([...containerEl.querySelectorAll("details[data-parent-path][open]")].map((el) => el.dataset.parentPath));
    containerEl.empty();
    containerEl.classList.add("ll-directory-settings");
    containerEl.createEl("h2", { text: "龙鳞首页" });
    containerEl.createEl("p", {
      text: "首页会自动读取所有根文件夹（排除 img）中的 Markdown 书页。",
      cls: "setting-item-description",
    });
    new Setting(containerEl)
      .setName("启动时打开首页")
      .setDesc("Obsidian 启动后，在没有首页标签时自动展开一卷新首页。")
      .addToggle((toggle) =>
        toggle.setValue(this.plugin.settings.openOnStartup).onChange(async (value) => {
          this.plugin.settings.openOnStartup = value;
          await this.plugin.saveSettings();
        }),
      );
    containerEl.createEl("h3", { text: "显示的目录" });
    containerEl.createEl("p", { text: "关闭目录后，其所有子目录也会从首页和搜索中隐藏；展开“子目录”可单独设置。img 始终排除。", cls: "setting-item-description" });
    const folders = [];
    const collect = (parent, depth = 0) => {
      const children = parent.children.filter((folder) => folder instanceof TFolder && !folder.name.startsWith(".") && !EXCLUDED_FOLDER_NAMES.has(folder.name.toLowerCase()))
        .sort((a, b) => a.name.localeCompare(b.name, "zh-CN", { numeric: true }));
      children.forEach((folder) => { folders.push({ folder, depth }); collect(folder, depth + 1); });
    };
    collect(this.app.vault.getRoot());
    const hidden = this.plugin.settings.hiddenFolders || [];
    const addToggle = (folder, target, depth) => {
      const blocked = isHiddenDirectory(folder.parent?.path || "/", hidden);
      const row = new Setting(target).setName(folder.name).setDesc(depth === 0 ? "根目录" : `${folder.path}${blocked ? "（父目录已隐藏）" : ""}`);
      row.settingEl.dataset.folderPath = folder.path;
      row.settingEl.classList.add(depth === 0 ? "ll-directory-parent" : "ll-directory-child");
      row.settingEl.style.marginInlineStart = `${Math.max(0, depth - 1) * 16}px`;
      row.addToggle((toggle) => toggle.setValue(!hidden.includes(folder.path)).setDisabled(blocked).onChange(async (visible) => {
        const values = new Set(this.plugin.settings.hiddenFolders || []);
        if (visible) values.delete(folder.path); else values.add(folder.path);
        this.plugin.settings.hiddenFolders = [...values];
        await this.plugin.saveSettings();
        await Promise.all(this.plugin.getHomeViews().map((view) => view.refresh()));
        const scrollTop = containerEl.scrollTop;
        this.display();
        containerEl.scrollTop = scrollTop;
      }));
    };
    for (const { folder, depth } of folders.filter((entry) => entry.depth === 0)) {
      const group = containerEl.createEl("section", { cls: "ll-directory-group" });
      group.setAttribute("aria-label", `${folder.name}目录设置`);
      addToggle(folder, group, depth);
      const descendants = folders.filter((entry) => entry.folder.path.startsWith(`${folder.path}/`));
      if (descendants.length) {
        const details = group.createEl("details", { cls: "ll-directory-details" });
        details.dataset.parentPath = folder.path;
        details.open = expanded.has(folder.path);
        details.createEl("summary", { text: `${folder.name}的子目录（${descendants.length}）` });
        const children = details.createEl("div", { cls: "ll-directory-children" });
        descendants.forEach((entry) => addToggle(entry.folder, children, entry.depth));
      }
    }
    new Setting(containerEl)
      .setName("清空摘要缓存")
      .setDesc("重新读取所有书页，并重新提取摘要。")
      .addButton((button) =>
        button.setButtonText("重新理卷").onClick(async () => {
          this.plugin.clearSummaryCache();
          const views = this.plugin.getHomeViews();
          await Promise.all(views.map((view) => view.refresh(true)));
        }),
      );
  }
}

class DragonScrollHomePlugin extends Plugin {
  async onload() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
    this.settings.hiddenFolders = Array.isArray(this.settings.hiddenFolders) ? this.settings.hiddenFolders.filter((path) => typeof path === "string") : [];
    this.summaryCache = new Map();
    this.refreshTimer = null;
    this.vaultDirty = false;
    this.registerView(VIEW_TYPE, (leaf) => new DragonScrollHomeView(leaf, this));
    this.addRibbonIcon("scroll-text", "打开龙鳞首页", () => {
      void this.activateView();
    });
    this.addCommand({
      id: "open-dragon-scroll-home",
      name: "打开龙鳞首页",
      callback: () => {
        void this.activateView();
      },
    });
    this.addCommand({
      id: "refresh-dragon-scroll-home",
      name: "重整龙鳞首页",
      callback: () => {
        this.clearSummaryCache();
        this.getHomeViews().forEach((view) => void view.refresh(true));
      },
    });
    this.addSettingTab(new DragonScrollHomeSettingTab(this.app, this));
    this.registerVaultEvents();
    this.app.workspace.onLayoutReady(() => {
      if (this.settings.openOnStartup && !this.getHomeViews().length) {
        window.setTimeout(() => {
          if (this.settings.openOnStartup && !this.getHomeViews().length) {
            void this.activateView();
          }
        }, 650);
      }
    });
    window.setTimeout(() => {
      if (this.settings.openOnStartup && !this.getHomeViews().length) {
        void this.activateView();
      }
    }, 1600);
  }

  async saveSettings() {
    await this.saveData(this.settings);
  }

  clearSummaryCache() {
    this.summaryCache.clear();
  }

  getHomeViews() {
    return this.app.workspace
      .getLeavesOfType(VIEW_TYPE)
      .map((leaf) => leaf.view)
      .filter((view) => view instanceof DragonScrollHomeView);
  }

  registerVaultEvents() {
    const scheduleRefresh = () => {
      window.clearTimeout(this.refreshTimer);
      this.refreshTimer = window.setTimeout(() => {
        this.getHomeViews().forEach((view) => void view.refresh());
        this.vaultDirty = false;
      }, 1400);
    };
    const handleStructureChange = (file) => {
      if (file instanceof TFolder || (file instanceof TFile && file.extension === "md")) {
        this.vaultDirty = true;
        scheduleRefresh();
      }
    };
    this.registerEvent(this.app.vault.on("create", handleStructureChange));
    this.registerEvent(this.app.vault.on("delete", handleStructureChange));
    this.registerEvent(this.app.vault.on("rename", handleStructureChange));
    this.registerEvent(
      this.app.vault.on("modify", (file) => {
        if (file instanceof TFile && file.extension === "md") this.vaultDirty = true;
      }),
    );
    this.registerEvent(
      this.app.workspace.on("active-leaf-change", (leaf) => {
        if (leaf?.view instanceof DragonScrollHomeView && this.vaultDirty) {
          this.vaultDirty = false;
          this.getHomeViews().forEach((view) => void view.refresh());
        }
      }),
    );
  }

  async activateView() {
    const existing = this.app.workspace.getLeavesOfType(VIEW_TYPE);
    if (existing.length) {
      await this.app.workspace.revealLeaf(existing[0]);
      return;
    }
    const leaf = this.app.workspace.getLeaf("tab");
    await leaf.setViewState({ type: VIEW_TYPE, active: true });
    await this.app.workspace.revealLeaf(leaf);
  }

  onunload() {
    window.clearTimeout(this.refreshTimer);
    this.app.workspace.detachLeavesOfType(VIEW_TYPE);
  }
}

module.exports = DragonScrollHomePlugin;
