const MAX_FILE_SIZE = 10 * 1024 * 1024;

const ALLOWED_EXTENSIONS = new Set([
  "jpg",
  "jpeg",
  "png",
  "pdf",
  "svg",
]);

const ALLOWED_CONTENT_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/svg+xml",
  "application/pdf",
]);

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=UTF-8",
      "cache-control": "no-store",
    },
  });
}

function getText(formData, name) {
  const value = formData.get(name);
  return typeof value === "string" ? value.trim() : "";
}

function safeFilename(filename) {
  const cleaned = filename
    .normalize("NFKD")
    .replace(/[^\w.-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^[-.]+|[-.]+$/g, "")
    .slice(0, 120);

  return cleaned || "artwork";
}

export async function onRequest(context) {
  const { request, env } = context;

  if (request.method !== "POST") {
    return jsonResponse(
      {
        ok: false,
        error: "Method not allowed.",
      },
      405,
    );
  }

  try {
    const contentType = request.headers.get("content-type") || "";

    if (!contentType.includes("multipart/form-data")) {
      return jsonResponse(
        {
          ok: false,
          error: "The form must use multipart/form-data.",
        },
        415,
      );
    }

    const formData = await request.formData();

    const name = getText(formData, "name");
    const email = getText(formData, "email");
    const phone = getText(formData, "phone");
    const product = getText(formData, "product");
    const quantity = getText(formData, "quantity");
    const deadline = getText(formData, "deadline");
    const message = getText(formData, "message");
    const website = getText(formData, "website");

    if (website) {
      return jsonResponse({
        ok: true,
        message: "Your quote request was received.",
      });
    }

    if (!name || !email || !product || !message) {
      return jsonResponse(
        {
          ok: false,
          error:
            "Name, email, product, and project details are required.",
        },
        400,
      );
    }

    const emailLooksValid =
      /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);

    if (!emailLooksValid) {
      return jsonResponse(
        {
          ok: false,
          error: "Please enter a valid email address.",
        },
        400,
      );
    }

    const quoteId = crypto.randomUUID();
    const createdAt = new Date().toISOString();
    const dateFolder = createdAt.slice(0, 10);

    let artworkDetails = null;
    const artwork = formData.get("artwork");

    if (artwork instanceof File && artwork.size > 0) {
      if (artwork.size > MAX_FILE_SIZE) {
        return jsonResponse(
          {
            ok: false,
            error: "Artwork must be 10 MB or smaller.",
          },
          413,
        );
      }

      const extension =
        artwork.name.split(".").pop()?.toLowerCase() || "";

      const validExtension =
        ALLOWED_EXTENSIONS.has(extension);

      const validContentType =
        !artwork.type ||
        ALLOWED_CONTENT_TYPES.has(artwork.type);

      if (!validExtension || !validContentType) {
        return jsonResponse(
          {
            ok: false,
            error:
              "Artwork must be a JPG, PNG, PDF, or SVG file.",
          },
          400,
        );
      }

      const artworkKey =
        `quotes/${dateFolder}/${quoteId}/` +
        safeFilename(artwork.name);

      await env.QUOTE_UPLOADS.put(
        artworkKey,
        artwork.stream(),
        {
          httpMetadata: {
            contentType:
              artwork.type || "application/octet-stream",
          },
          customMetadata: {
            quoteId,
            originalName: artwork.name,
          },
        },
      );

      artworkDetails = {
        key: artworkKey,
        originalName: artwork.name,
        contentType:
          artwork.type || "application/octet-stream",
        size: artwork.size,
      };
    }

    const quoteRecord = {
      quoteId,
      createdAt,
      status: "new",
      name,
      email,
      phone,
      product,
      quantity,
      deadline,
      message,
      artwork: artworkDetails,
    };

    const recordKey =
      `quotes/${dateFolder}/${quoteId}/request.json`;

    await env.QUOTE_UPLOADS.put(
      recordKey,
      JSON.stringify(quoteRecord, null, 2),
      {
        httpMetadata: {
          contentType:
            "application/json; charset=UTF-8",
        },
        customMetadata: {
          quoteId,
          status: "new",
        },
      },
    );
let notificationSent = false;

try {
  const notificationResponse =
    await env.QUOTE_NOTIFIER.fetch(
      "https://runi-quote-notifier.internal/notify",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify(quoteRecord),
      },
    );

  notificationSent = notificationResponse.ok;

  if (!notificationResponse.ok) {
    console.error(
      "Quote email notification failed:",
      await notificationResponse.text(),
    );
  }
} catch (notificationError) {
  console.error(
    "Quote email notification failed:",
    notificationError,
  );
}
    return jsonResponse(
      {
        ok: true,
        quoteId,
        notificationSent,
        message:
          "Thanks! Your quote request was received. We’ll follow up soon.",
      },
      201,
    );
  } catch (error) {
    console.error("Quote submission failed:", error);

    return jsonResponse(
      {
        ok: false,
        error:
          "We could not submit your request. Please try again in a moment.",
      },
      500,
    );
  }
}
