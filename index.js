const express = require("express");
const cors = require("cors");
const sqlite3 = require("sqlite3").verbose();
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const dotenv = require("dotenv");
const path = require("path");

dotenv.config();

const app = express();
const PORT = process.env.PORT || 4000;
const JWT_SECRET = process.env.JWT_SECRET || "laravel-ai-node-secret";
const DB_PATH = path.resolve(
  __dirname,
  process.env.DB_PATH || "../laravel-api/database/database.sqlite",
);

const db = new sqlite3.Database(DB_PATH, (err) => {
  if (err) {
    console.error("Failed to connect to database:", err.message);
  } else {
    console.log("Connected to SQLite database:", DB_PATH);
  }
});

app.use(cors());
app.use(express.json());

function run(query, params = []) {
  return new Promise((resolve, reject) => {
    db.all(query, params, (err, rows) => {
      if (err) {
        reject(err);
        return;
      }
      resolve(rows);
    });
  });
}

function runOne(query, params = []) {
  return new Promise((resolve, reject) => {
    db.get(query, params, (err, row) => {
      if (err) {
        reject(err);
        return;
      }
      resolve(row);
    });
  });
}

function runStatement(query, params = []) {
  return new Promise((resolve, reject) => {
    db.run(query, params, function (err) {
      if (err) {
        reject(err);
        return;
      }
      resolve({ id: this.lastID, changes: this.changes });
    });
  });
}

function paginate(items, page = 1, perPage = 6, basePath = "/blog") {
  const pageNumber = Number(page) > 0 ? Number(page) : 1;
  const total = items.length;
  const totalPages = Math.max(1, Math.ceil(total / perPage));
  const start = (pageNumber - 1) * perPage;
  const end = start + perPage;

  return {
    data: items.slice(start, end),
    current_page: pageNumber,
    last_page: totalPages,
    total,
    per_page: perPage,
    next_page_url:
      pageNumber < totalPages ? `${basePath}?page=${pageNumber + 1}` : null,
    prev_page_url: pageNumber > 1 ? `${basePath}?page=${pageNumber - 1}` : null,
  };
}

function parseJsonArray(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value;
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function mapProductRow(product, categoryOverride = null) {
  const category = categoryOverride || {
    id: product.category_id,
    name: product.category_name,
    slug: product.category_slug,
  };

  return {
    id: product.id,
    slug: product.slug,
    title: product.title,
    description: product.description,
    image: product.image,
    sku: product.sku,
    price: Number(product.price || 0),
    tags: parseJsonArray(product.tags),
    category: category && category.name ? category : null,
    published_at: product.created_at,
  };
}

function authenticateToken(req, res, next) {
  const authHeader = req.headers.authorization || "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;

  if (!token) {
    return res.status(401).json({ message: "Unauthorized" });
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded;
    next();
  } catch (error) {
    return res.status(401).json({ message: "Invalid token" });
  }
}

function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user || !roles.includes(req.user.role)) {
      return res.status(403).json({ message: "Forbidden" });
    }
    next();
  };
}

app.get("/api/site", async (req, res) => {
  res.json({
    name: "Laravel AI",
    tagline: "Build faster with a Laravel API and a modern Next.js frontend.",
    hero: {
      title: "Launch smarter digital experiences.",
      subtitle:
        "A clean architecture for modern web products, content sites, and business dashboards.",
    },
    features: [
      "Laravel API foundation",
      "Next.js user experience",
      "Content-driven blog pages",
      "Fast setup and clear structure",
    ],
  });
});

app.get("/api/pages", async (req, res) => {
  try {
    const rows = await run(
      "SELECT * FROM pages WHERE status = 'published' ORDER BY title ASC",
    );
    res.json(
      rows.map((page) => ({
        id: page.id,
        title: page.title,
        slug: page.slug,
        content: page.content,
        photo: page.photo,
        meta_title: page.meta_title,
        meta_description: page.meta_description,
        meta_keywords: page.meta_keywords,
        meta_fields: page.meta_fields ? JSON.parse(page.meta_fields) : null,
      })),
    );
  } catch (error) {
    res.status(500).json({ message: "Database error", error: error.message });
  }
});

app.get("/api/pages/:slug", async (req, res) => {
  try {
    const row = await runOne(
      "SELECT * FROM pages WHERE slug = ? AND status = 'published' LIMIT 1",
      [req.params.slug],
    );
    if (!row) {
      return res.status(404).json({ message: "Page not found" });
    }

    return res.json({
      id: row.id,
      title: row.title,
      slug: row.slug,
      content: row.content,
      photo: row.photo,
      meta_title: row.meta_title,
      meta_description: row.meta_description,
      meta_keywords: row.meta_keywords,
      meta_fields: row.meta_fields ? JSON.parse(row.meta_fields) : null,
    });
  } catch (error) {
    return res
      .status(500)
      .json({ message: "Database error", error: error.message });
  }
});

app.get("/api/blog", async (req, res) => {
  try {
    const page = Number(req.query.page || 1);
    const rows = await run(`
      SELECT bp.*, c.name AS category_name, c.slug AS category_slug
      FROM blog_posts bp
      LEFT JOIN categories c ON c.id = bp.category_id
      WHERE bp.status = 'published'
      ORDER BY bp.created_at DESC
    `);

    const mapped = rows.map((post) => ({
      id: post.id,
      slug: post.slug,
      title: post.title,
      excerpt: post.excerpt,
      photo: post.photo,
      published_at: post.created_at,
      category: post.category_name
        ? {
            id: post.category_id,
            name: post.category_name,
            slug: post.category_slug,
          }
        : null,
    }));

    const paged = paginate(mapped, page, 6);
    res.json({
      data: paged.data,
      current_page: paged.current_page,
      last_page: paged.last_page,
      total: paged.total,
      per_page: paged.per_page,
      next_page_url: paged.next_page_url,
      prev_page_url: paged.prev_page_url,
    });
  } catch (error) {
    res.status(500).json({ message: "Database error", error: error.message });
  }
});

app.get("/api/blog/:slug", async (req, res) => {
  try {
    const row = await runOne(
      `
      SELECT bp.*, c.name AS category_name, c.slug AS category_slug
      FROM blog_posts bp
      LEFT JOIN categories c ON c.id = bp.category_id
      WHERE bp.slug = ? AND bp.status = 'published'
      LIMIT 1
    `,
      [req.params.slug],
    );

    if (!row) {
      return res.status(404).json({ message: "Post not found" });
    }

    return res.json({
      title: row.title,
      content: row.content,
      photo: row.photo,
      category: row.category_name
        ? {
            id: row.category_id,
            name: row.category_name,
            slug: row.category_slug,
          }
        : null,
    });
  } catch (error) {
    return res
      .status(500)
      .json({ message: "Database error", error: error.message });
  }
});

app.get("/api/categories", async (req, res) => {
  try {
    const rows = await run(
      "SELECT id, name, slug FROM categories ORDER BY name ASC",
    );
    res.json(rows);
  } catch (error) {
    res.status(500).json({ message: "Database error", error: error.message });
  }
});

app.get("/api/categories/:slug/blog", async (req, res) => {
  try {
    const category = await runOne(
      "SELECT id, name, slug FROM categories WHERE slug = ? LIMIT 1",
      [req.params.slug],
    );
    if (!category) {
      return res.status(404).json({ message: "Category not found" });
    }

    const rows = await run(
      `
      SELECT bp.*, c.name AS category_name, c.slug AS category_slug
      FROM blog_posts bp
      LEFT JOIN categories c ON c.id = bp.category_id
      WHERE bp.category_id = ? AND bp.status = 'published'
      ORDER BY bp.created_at DESC
    `,
      [category.id],
    );

    const mapped = rows.map((post) => ({
      id: post.id,
      slug: post.slug,
      title: post.title,
      excerpt: post.excerpt,
      photo: post.photo,
      published_at: post.created_at,
      category: {
        id: category.id,
        name: category.name,
        slug: category.slug,
      },
    }));

    const page = Number(req.query.page || 1);
    const paged = paginate(mapped, page, 6);

    return res.json({
      category,
      data: paged.data,
      current_page: paged.current_page,
      last_page: paged.last_page,
      total: paged.total,
      per_page: paged.per_page,
      next_page_url: paged.next_page_url,
      prev_page_url: paged.prev_page_url,
    });
  } catch (error) {
    return res
      .status(500)
      .json({ message: "Database error", error: error.message });
  }
});

app.get("/api/products", async (req, res) => {
  try {
    const page = Number(req.query.page || 1);
    const rows = await run(`
      SELECT p.*, c.name AS category_name, c.slug AS category_slug
      FROM products p
      LEFT JOIN categories c ON c.id = p.category_id
      WHERE p.status = 'published'
      ORDER BY p.created_at DESC
    `);

    const items = rows.map((product) => mapProductRow(product));
    const perPage = 12;
    const totalPages = Math.max(1, Math.ceil(items.length / perPage));
    const currentPage = Number.isFinite(page) && page > 0 ? page : 1;
    const safePage = Math.min(currentPage, totalPages);
    const start = (safePage - 1) * perPage;
    const end = start + perPage;

    return res.json({
      data: items.slice(start, end),
      current_page: safePage,
      last_page: totalPages,
      total: items.length,
      per_page: perPage,
      next_page_url:
        safePage < totalPages ? `/api/products?page=${safePage + 1}` : null,
      prev_page_url: safePage > 1 ? `/api/products?page=${safePage - 1}` : null,
    });
  } catch (error) {
    return res
      .status(500)
      .json({ message: "Database error", error: error.message });
  }
});

app.get("/api/products/:slug", async (req, res) => {
  try {
    const row = await runOne(
      `
      SELECT p.*, c.name AS category_name, c.slug AS category_slug
      FROM products p
      LEFT JOIN categories c ON c.id = p.category_id
      WHERE p.slug = ? AND p.status = 'published'
      LIMIT 1
    `,
      [req.params.slug],
    );

    if (!row) {
      return res.status(404).json({ message: "Product not found" });
    }

    return res.json({
      id: row.id,
      title: row.title,
      slug: row.slug,
      description: row.description,
      image: row.image,
      sku: row.sku,
      price: Number(row.price || 0),
      tags: parseJsonArray(row.tags),
      custom_fields: parseJsonArray(row.custom_fields),
      variations: parseJsonArray(row.variations),
      category: row.category_name
        ? {
            id: row.category_id,
            name: row.category_name,
            slug: row.category_slug,
          }
        : null,
    });
  } catch (error) {
    return res
      .status(500)
      .json({ message: "Database error", error: error.message });
  }
});

app.get("/api/products/category/:slug", async (req, res) => {
  try {
    const category = await runOne(
      "SELECT id, name, slug FROM categories WHERE slug = ? LIMIT 1",
      [req.params.slug],
    );

    if (!category) {
      return res.status(404).json({ message: "Category not found" });
    }

    const rows = await run(
      `
      SELECT p.*, c.name AS category_name, c.slug AS category_slug
      FROM products p
      LEFT JOIN categories c ON c.id = p.category_id
      WHERE p.category_id = ? AND p.status = 'published'
      ORDER BY p.created_at DESC
    `,
      [category.id],
    );

    const items = rows.map((product) => mapProductRow(product, category));
    const page = Number(req.query.page || 1);
    const perPage = 12;
    const totalPages = Math.max(1, Math.ceil(items.length / perPage));
    const currentPage = Number.isFinite(page) && page > 0 ? page : 1;
    const safePage = Math.min(currentPage, totalPages);
    const start = (safePage - 1) * perPage;
    const end = start + perPage;

    return res.json({
      category,
      data: items.slice(start, end),
      current_page: safePage,
      last_page: totalPages,
      total: items.length,
      per_page: perPage,
      next_page_url:
        safePage < totalPages
          ? `/api/products/category/${category.slug}?page=${safePage + 1}`
          : null,
      prev_page_url:
        safePage > 1
          ? `/api/products/category/${category.slug}?page=${safePage - 1}`
          : null,
    });
  } catch (error) {
    return res
      .status(500)
      .json({ message: "Database error", error: error.message });
  }
});

app.get("/api/products/tag/:tag", async (req, res) => {
  try {
    const targetTag = String(req.params.tag || "")
      .trim()
      .toLowerCase();
    const rows = await run(`
      SELECT p.*, c.name AS category_name, c.slug AS category_slug
      FROM products p
      LEFT JOIN categories c ON c.id = p.category_id
      WHERE p.status = 'published'
      ORDER BY p.created_at DESC
    `);

    const filtered = rows.filter((product) => {
      const tags = parseJsonArray(product.tags).map((tag) =>
        String(tag).trim().toLowerCase(),
      );
      return tags.includes(targetTag);
    });

    const items = filtered.map((product) => mapProductRow(product));
    const page = Number(req.query.page || 1);
    const perPage = 12;
    const totalPages = Math.max(1, Math.ceil(items.length / perPage));
    const currentPage = Number.isFinite(page) && page > 0 ? page : 1;
    const safePage = Math.min(currentPage, totalPages);
    const start = (safePage - 1) * perPage;
    const end = start + perPage;

    return res.json({
      tag: req.params.tag,
      data: items.slice(start, end),
      current_page: safePage,
      last_page: totalPages,
      total: items.length,
      per_page: perPage,
      next_page_url:
        safePage < totalPages
          ? `/api/products/tag/${encodeURIComponent(req.params.tag)}?page=${safePage + 1}`
          : null,
      prev_page_url:
        safePage > 1
          ? `/api/products/tag/${encodeURIComponent(req.params.tag)}?page=${safePage - 1}`
          : null,
    });
  } catch (error) {
    return res
      .status(500)
      .json({ message: "Database error", error: error.message });
  }
});

app.get("/api/product-categories", async (req, res) => {
  try {
    const rows = await run(
      "SELECT id, name, slug FROM categories ORDER BY name ASC",
    );
    return res.json(rows);
  } catch (error) {
    return res
      .status(500)
      .json({ message: "Database error", error: error.message });
  }
});

app.get("/api/product-tags", async (req, res) => {
  try {
    const rows = await run(
      "SELECT tags FROM products WHERE status = 'published'",
    );
    const values = rows.flatMap((row) => parseJsonArray(row.tags));
    const unique = [...new Set(values.map((tag) => String(tag).trim()))].filter(
      Boolean,
    );
    return res.json(unique);
  } catch (error) {
    return res
      .status(500)
      .json({ message: "Database error", error: error.message });
  }
});

app.get(
  "/api/products-admin",
  authenticateToken,
  requireRole("admin", "editor"),
  async (req, res) => {
    try {
      const rows = await run(`
        SELECT p.*, c.name AS category_name, c.slug AS category_slug
        FROM products p
        LEFT JOIN categories c ON c.id = p.category_id
        ORDER BY p.id DESC
      `);

      return res.json(
        rows.map((product) => ({
          id: product.id,
          title: product.title,
          slug: product.slug,
          sku: product.sku,
          price: Number(product.price || 0),
          status: product.status,
          image: product.image,
          category: product.category_name
            ? {
                id: product.category_id,
                name: product.category_name,
                slug: product.category_slug,
              }
            : null,
          tags: parseJsonArray(product.tags),
          custom_fields: parseJsonArray(product.custom_fields),
          variations: parseJsonArray(product.variations),
          created_at: product.created_at,
        })),
      );
    } catch (error) {
      return res
        .status(500)
        .json({ message: "Database error", error: error.message });
    }
  },
);

app.post(
  "/api/products-admin",
  authenticateToken,
  requireRole("admin", "editor"),
  async (req, res) => {
    try {
      const {
        title,
        slug,
        description,
        image,
        sku,
        price,
        category_id,
        tags,
        custom_fields,
        variations,
        status,
      } = req.body || {};

      if (!title || !slug || !sku || price === undefined || price === null) {
        return res.status(400).json({
          message: "Title, slug, sku and price are required",
        });
      }

      const existingSlug = await runOne(
        "SELECT id FROM products WHERE slug = ?",
        [slug],
      );
      if (existingSlug) {
        return res.status(409).json({ message: "Slug already exists" });
      }

      const existingSku = await runOne(
        "SELECT id FROM products WHERE sku = ?",
        [sku],
      );
      if (existingSku) {
        return res.status(409).json({ message: "SKU already exists" });
      }

      const result = await runStatement(
        'INSERT INTO products (user_id, category_id, title, slug, description, image, sku, price, tags, custom_fields, variations, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime("now"), datetime("now"))',
        [
          req.user.id,
          category_id || null,
          title,
          slug,
          description || null,
          image || null,
          sku,
          Number(price),
          tags ? JSON.stringify(tags) : null,
          custom_fields ? JSON.stringify(custom_fields) : null,
          variations ? JSON.stringify(variations) : null,
          status || "draft",
        ],
      );

      const product = await runOne("SELECT * FROM products WHERE id = ?", [
        result.id,
      ]);
      return res.status(201).json(product);
    } catch (error) {
      return res
        .status(500)
        .json({ message: "Database error", error: error.message });
    }
  },
);

app.put(
  "/api/products-admin/:product",
  authenticateToken,
  requireRole("admin", "editor"),
  async (req, res) => {
    try {
      const current = await runOne("SELECT * FROM products WHERE id = ?", [
        req.params.product,
      ]);
      if (!current) {
        return res.status(404).json({ message: "Product not found" });
      }

      const {
        title,
        slug,
        description,
        image,
        sku,
        price,
        category_id,
        tags,
        custom_fields,
        variations,
        status,
      } = req.body || {};

      const nextSlug = slug || current.slug;
      const slugExists = await runOne(
        "SELECT id FROM products WHERE slug = ? AND id != ?",
        [nextSlug, current.id],
      );
      if (slugExists) {
        return res.status(409).json({ message: "Slug already exists" });
      }

      const nextSku = sku || current.sku;
      const skuExists = await runOne(
        "SELECT id FROM products WHERE sku = ? AND id != ?",
        [nextSku, current.id],
      );
      if (skuExists) {
        return res.status(409).json({ message: "SKU already exists" });
      }

      await runStatement(
        `UPDATE products SET category_id = ?, title = ?, slug = ?, description = ?, image = ?, sku = ?, price = ?, tags = ?, custom_fields = ?, variations = ?, status = ?, updated_at = datetime("now") WHERE id = ?`,
        [
          category_id ?? current.category_id,
          title || current.title,
          nextSlug,
          description ?? current.description,
          image ?? current.image,
          nextSku,
          Number(price ?? current.price),
          tags ? JSON.stringify(tags) : current.tags,
          custom_fields ? JSON.stringify(custom_fields) : current.custom_fields,
          variations ? JSON.stringify(variations) : current.variations,
          status || current.status,
          current.id,
        ],
      );

      const product = await runOne("SELECT * FROM products WHERE id = ?", [
        current.id,
      ]);
      return res.json(product);
    } catch (error) {
      return res
        .status(500)
        .json({ message: "Database error", error: error.message });
    }
  },
);

app.delete(
  "/api/products-admin/:product",
  authenticateToken,
  requireRole("admin"),
  async (req, res) => {
    try {
      const current = await runOne("SELECT * FROM products WHERE id = ?", [
        req.params.product,
      ]);
      if (!current) {
        return res.status(404).json({ message: "Product not found" });
      }

      await runStatement("DELETE FROM products WHERE id = ?", [
        req.params.product,
      ]);
      return res.json({ message: "Product deleted successfully" });
    } catch (error) {
      return res
        .status(500)
        .json({ message: "Database error", error: error.message });
    }
  },
);

app.post("/api/register", async (req, res) => {
  try {
    const { name, email, password, role } = req.body || {};
    if (!name || !email || !password) {
      return res
        .status(400)
        .json({ message: "Name, email and password are required" });
    }

    const existing = await runOne("SELECT id FROM users WHERE email = ?", [
      email,
    ]);
    if (existing) {
      return res.status(409).json({ message: "User already exists" });
    }

    const hashed = await bcrypt.hash(password, 10);
    const result = await runStatement(
      'INSERT INTO users (name, email, password, role, created_at, updated_at) VALUES (?, ?, ?, ?, datetime("now"), datetime("now"))',
      [name, email, hashed, role || "editor"],
    );

    const user = await runOne(
      "SELECT id, name, email, role FROM users WHERE id = ?",
      [result.id],
    );
    const token = jwt.sign(
      { id: user.id, name: user.name, email: user.email, role: user.role },
      JWT_SECRET,
      { expiresIn: "7d" },
    );

    return res.status(201).json({ user, token });
  } catch (error) {
    return res
      .status(500)
      .json({ message: "Database error", error: error.message });
  }
});

app.post("/api/login", async (req, res) => {
  try {
    const { email, password } = req.body || {};
    if (!email || !password) {
      return res
        .status(400)
        .json({ message: "Email and password are required" });
    }

    const user = await runOne("SELECT * FROM users WHERE email = ?", [email]);
    if (!user) {
      return res.status(401).json({ message: "Invalid credentials" });
    }

    const valid = await bcrypt.compare(password, user.password);
    if (!valid) {
      return res.status(401).json({ message: "Invalid credentials" });
    }

    const token = jwt.sign(
      { id: user.id, name: user.name, email: user.email, role: user.role },
      JWT_SECRET,
      { expiresIn: "7d" },
    );

    return res.json({
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
      },
      token,
    });
  } catch (error) {
    return res
      .status(500)
      .json({ message: "Database error", error: error.message });
  }
});

app.get("/api/user", authenticateToken, (req, res) => {
  res.json({ user: req.user });
});

app.get(
  "/api/posts",
  authenticateToken,
  requireRole("admin", "editor"),
  async (req, res) => {
    try {
      const rows = await run(`
      SELECT bp.*, u.name AS author_name
      FROM blog_posts bp
      LEFT JOIN users u ON u.id = bp.user_id
      ORDER BY bp.id DESC
    `);

      res.json(
        rows.map((post) => ({
          id: post.id,
          title: post.title,
          slug: post.slug,
          excerpt: post.excerpt,
          content: post.content,
          photo: post.photo,
          status: post.status,
          author: post.author_name,
          created_at: post.created_at,
        })),
      );
    } catch (error) {
      res.status(500).json({ message: "Database error", error: error.message });
    }
  },
);

app.post(
  "/api/posts",
  authenticateToken,
  requireRole("admin", "editor"),
  async (req, res) => {
    try {
      const { title, slug, excerpt, content, photo, status } = req.body || {};
      if (!title || !slug || !content) {
        return res
          .status(400)
          .json({ message: "Title, slug and content are required" });
      }

      const existing = await runOne(
        "SELECT id FROM blog_posts WHERE slug = ?",
        [slug],
      );
      if (existing) {
        return res.status(409).json({ message: "Slug already exists" });
      }

      const result = await runStatement(
        'INSERT INTO blog_posts (user_id, title, slug, excerpt, content, photo, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, datetime("now"), datetime("now"))',
        [
          req.user.id,
          title,
          slug,
          excerpt || "",
          content,
          photo || null,
          status || "draft",
        ],
      );

      const post = await runOne("SELECT * FROM blog_posts WHERE id = ?", [
        result.id,
      ]);
      return res.status(201).json(post);
    } catch (error) {
      return res
        .status(500)
        .json({ message: "Database error", error: error.message });
    }
  },
);

app.get(
  "/api/pages-admin",
  authenticateToken,
  requireRole("admin", "editor"),
  async (req, res) => {
    try {
      const rows = await run("SELECT * FROM pages ORDER BY id ASC");
      res.json(rows);
    } catch (error) {
      res.status(500).json({ message: "Database error", error: error.message });
    }
  },
);

app.post(
  "/api/pages-admin",
  authenticateToken,
  requireRole("admin", "editor"),
  async (req, res) => {
    try {
      const {
        title,
        slug,
        content,
        photo,
        status,
        meta_title,
        meta_description,
        meta_keywords,
        meta_fields,
      } = req.body || {};
      if (!title || !slug) {
        return res.status(400).json({ message: "Title and slug are required" });
      }

      const existing = await runOne("SELECT id FROM pages WHERE slug = ?", [
        slug,
      ]);
      if (existing) {
        return res.status(409).json({ message: "Slug already exists" });
      }

      const result = await runStatement(
        'INSERT INTO pages (title, slug, content, photo, status, meta_title, meta_description, meta_keywords, meta_fields, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime("now"), datetime("now"))',
        [
          title,
          slug,
          content || null,
          photo || null,
          status || "draft",
          meta_title || null,
          meta_description || null,
          meta_keywords || null,
          meta_fields ? JSON.stringify(meta_fields) : null,
        ],
      );

      const page = await runOne("SELECT * FROM pages WHERE id = ?", [
        result.id,
      ]);
      return res.status(201).json(page);
    } catch (error) {
      return res
        .status(500)
        .json({ message: "Database error", error: error.message });
    }
  },
);

app.put(
  "/api/pages-admin/:page",
  authenticateToken,
  requireRole("admin", "editor"),
  async (req, res) => {
    try {
      const {
        title,
        slug,
        content,
        photo,
        status,
        meta_title,
        meta_description,
        meta_keywords,
        meta_fields,
      } = req.body || {};
      const current = await runOne("SELECT * FROM pages WHERE id = ?", [
        req.params.page,
      ]);
      if (!current) {
        return res.status(404).json({ message: "Page not found" });
      }

      const nextSlug = slug || current.slug;
      const slugExists = await runOne(
        "SELECT id FROM pages WHERE slug = ? AND id != ?",
        [nextSlug, current.id],
      );
      if (slugExists) {
        return res.status(409).json({ message: "Slug already exists" });
      }

      await runStatement(
        `UPDATE pages SET title = ?, slug = ?, content = ?, photo = ?, status = ?, meta_title = ?, meta_description = ?, meta_keywords = ?, meta_fields = ?, updated_at = datetime("now") WHERE id = ?`,
        [
          title || current.title,
          nextSlug,
          content ?? current.content,
          photo ?? current.photo,
          status || current.status,
          meta_title ?? current.meta_title,
          meta_description ?? current.meta_description,
          meta_keywords ?? current.meta_keywords,
          meta_fields ? JSON.stringify(meta_fields) : current.meta_fields,
          current.id,
        ],
      );

      const page = await runOne("SELECT * FROM pages WHERE id = ?", [
        current.id,
      ]);
      return res.json(page);
    } catch (error) {
      return res
        .status(500)
        .json({ message: "Database error", error: error.message });
    }
  },
);

app.delete(
  "/api/pages-admin/:page",
  authenticateToken,
  requireRole("admin"),
  async (req, res) => {
    try {
      const current = await runOne("SELECT * FROM pages WHERE id = ?", [
        req.params.page,
      ]);
      if (!current) {
        return res.status(404).json({ message: "Page not found" });
      }

      await runStatement("DELETE FROM pages WHERE id = ?", [req.params.page]);
      return res.json({ message: "Page deleted successfully" });
    } catch (error) {
      return res
        .status(500)
        .json({ message: "Database error", error: error.message });
    }
  },
);

app.put(
  "/api/posts/:post",
  authenticateToken,
  requireRole("admin", "editor"),
  async (req, res) => {
    try {
      const { title, slug, excerpt, content, photo, status } = req.body || {};
      const current = await runOne("SELECT * FROM blog_posts WHERE id = ?", [
        req.params.post,
      ]);
      if (!current) {
        return res.status(404).json({ message: "Post not found" });
      }

      const nextSlug = slug || current.slug;
      const slugExists = await runOne(
        "SELECT id FROM blog_posts WHERE slug = ? AND id != ?",
        [nextSlug, current.id],
      );
      if (slugExists) {
        return res.status(409).json({ message: "Slug already exists" });
      }

      await runStatement(
        `UPDATE blog_posts SET title = ?, slug = ?, excerpt = ?, content = ?, photo = ?, status = ?, updated_at = datetime("now") WHERE id = ?`,
        [
          title || current.title,
          nextSlug,
          excerpt ?? current.excerpt,
          content ?? current.content,
          photo ?? current.photo,
          status || current.status,
          current.id,
        ],
      );

      const post = await runOne("SELECT * FROM blog_posts WHERE id = ?", [
        current.id,
      ]);
      return res.json(post);
    } catch (error) {
      return res
        .status(500)
        .json({ message: "Database error", error: error.message });
    }
  },
);

app.delete(
  "/api/posts/:post",
  authenticateToken,
  requireRole("admin"),
  async (req, res) => {
    try {
      const current = await runOne("SELECT * FROM blog_posts WHERE id = ?", [
        req.params.post,
      ]);
      if (!current) {
        return res.status(404).json({ message: "Post not found" });
      }

      await runStatement("DELETE FROM blog_posts WHERE id = ?", [
        req.params.post,
      ]);
      return res.json({ message: "Post deleted successfully" });
    } catch (error) {
      return res
        .status(500)
        .json({ message: "Database error", error: error.message });
    }
  },
);

app.get("/api/health", (req, res) => {
  res.json({ status: "ok" });
});

app.listen(PORT, () => {
  console.log(`Node API running on http://127.0.0.1:${PORT}/api`);
});
