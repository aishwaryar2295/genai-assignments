// GitHub Code Reviewer Agent — AI Tester
// Phase 5/6: real n8n GET integration plus safe Markdown rendering of the response.
(function () {
  "use strict";

  // Single source of truth for the n8n integration contract; update here only.
  var CONFIG = {
    reviewWebhookUrl: "http://localhost:5678/webhook/Github_code_reviewer",
    reviewWebhookQueryParam: "url",
    emailWebhookUrl: "http://localhost:5678/webhook/Github_code_reviewer_email"
  };

  var form = document.getElementById("review-form");
  var input = document.getElementById("github-url");
  var submitButton = document.getElementById("review-submit-button");
  var errorEl = document.getElementById("github-url-error");
  var workspace = document.getElementById("review-workspace");
  var submittedUrlEl = document.getElementById("review-workspace__submitted-url");
  var resultContentEl = document.getElementById("review-result-content");
  var requestErrorMessageEl = document.getElementById("review-error-message");
  var resultsHeading = document.getElementById("review-results-heading");
  var retryButton = document.getElementById("review-retry-button");
  var reviewAgainButtons = document.querySelectorAll(".js-review-again");
  var statusAnnouncer = document.getElementById("status-announcer");
  var copyReviewButton = document.getElementById("copy-review-button");
  var showEmailButton = document.getElementById("show-email-button");
  var emailForm = document.getElementById("email-form");
  var recipientEmailInput = document.getElementById("recipient-email");
  var sendEmailButton = document.getElementById("send-email-button");
  var recipientEmailError = document.getElementById("recipient-email-error");
  var emailFormStatus = document.getElementById("email-form-status");

  var views = workspace.querySelectorAll("[data-state-view]");
  var lastSubmittedUrl = "";
  var lastReviewText = "";
  var requestInProgress = false;
  var emailRequestInProgress = false;

  function setWorkspaceState(stateName) {
    workspace.setAttribute("data-state", stateName);
    views.forEach(function (view) {
      view.hidden = view.getAttribute("data-state-view") !== stateName;
    });
  }

  function announce(message) {
    statusAnnouncer.textContent = message;
  }

  function setFormBusy(isBusy) {
    requestInProgress = isBusy;
    input.disabled = isBusy;
    submitButton.disabled = isBusy;
    retryButton.disabled = isBusy;
  }

  function clearValidationError() {
    input.removeAttribute("aria-invalid");
    errorEl.hidden = true;
    errorEl.textContent = "";
  }

  function showValidationError(message) {
    input.setAttribute("aria-invalid", "true");
    errorEl.hidden = false;
    errorEl.textContent = message;
    announce(message);
  }

  // Validates the confirmed contract: https://github.com/<owner>/<repo>/blob/<ref>/<path...>
  function validateGitHubFileUrl(rawValue) {
    var value = rawValue.trim();

    if (!value) {
      return { valid: false, message: "Enter a GitHub file URL to continue." };
    }

    var parsed;
    try {
      parsed = new URL(value);
    } catch (error) {
      return {
        valid: false,
        message: "Enter a valid URL, for example https://github.com/owner/repo/blob/main/path/to/File.ext"
      };
    }

    if (parsed.protocol !== "https:") {
      return { valid: false, message: "The URL must start with https://." };
    }

    if (parsed.hostname.toLowerCase() !== "github.com") {
      return { valid: false, message: "The URL must be a github.com file link." };
    }

    var segments = parsed.pathname.split("/").filter(Boolean);
    var blobIndex = segments.indexOf("blob");

    if (segments.length < 2) {
      return { valid: false, message: "Enter a direct file URL, not just a GitHub domain." };
    }

    if (blobIndex !== 2) {
      return {
        valid: false,
        message:
          "Enter a direct file URL in the form https://github.com/owner/repo/blob/branch/path/to/file " +
          "(a repository page is not a direct file URL)."
      };
    }

    var owner = segments[0];
    var repo = segments[1];
    var ref = segments[3];
    var filePathSegments = segments.slice(4);

    if (!owner || !repo || !ref || filePathSegments.length === 0) {
      return { valid: false, message: "The URL must include an owner, repository, branch, and file path." };
    }

    return { valid: true, value: value };
  }

  // Builds the GET request URL, letting URLSearchParams handle encoding of the GitHub URL.
  function buildReviewRequestUrl(githubFileUrl) {
    var requestUrl = new URL(CONFIG.reviewWebhookUrl);
    requestUrl.searchParams.set(CONFIG.reviewWebhookQueryParam, githubFileUrl);
    return requestUrl.toString();
  }

  function renderReviewResult(url, reviewText) {
    lastReviewText = reviewText;
    submittedUrlEl.textContent = url;
    try {
      resultContentEl.innerHTML = window.SimpleMarkdown.render(reviewText);
    } catch (error) {
      // Fall back to safe plain text if rendering unexpectedly throws.
      resultContentEl.textContent = reviewText;
    }
    setWorkspaceState("ready");
    announce("Review completed for " + url);
  }

  function clearReviewResult() {
    submittedUrlEl.textContent = "";
    resultContentEl.textContent = "";
    lastReviewText = "";
    requestErrorMessageEl.textContent = "The review could not be completed. Retry, or review another file.";
    emailForm.hidden = true;
    recipientEmailInput.value = "";
    recipientEmailInput.removeAttribute("aria-invalid");
    recipientEmailError.hidden = true;
    recipientEmailError.textContent = "";
    emailFormStatus.textContent = "";
    sendEmailButton.disabled = true;
  }

  function isValidEmail(value) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
  }

  function getReviewedFileName(url) {
    var path = new URL(url).pathname.split("/").filter(Boolean);
    return decodeURIComponent(path[path.length - 1] || "code-review");
  }

  function updateEmailButtonState() {
    sendEmailButton.disabled = !isValidEmail(recipientEmailInput.value);
  }

  function showEmailValidationError(message) {
    recipientEmailInput.setAttribute("aria-invalid", "true");
    recipientEmailError.hidden = false;
    recipientEmailError.textContent = message;
    emailFormStatus.textContent = "";
  }

  function focusResultsHeading() {
    resultsHeading.focus({ preventScroll: true });
  }

  function showRequestError(message) {
  focusResultsHeading();
    requestErrorMessageEl.textContent = message;
    setWorkspaceState("error");
    focusResultsHeading();
    announce(message);
  }

  function beginReview(url) {
    if (requestInProgress || !url) {
      return;
    }

    lastSubmittedUrl = url;
    clearReviewResult();
    setFormBusy(true);
    setWorkspaceState("loading");
    announce("Review in progress for " + url);

    fetch(buildReviewRequestUrl(url), { method: "GET" })
      .then(function (response) {
        if (!response.ok) {
          throw new Error("The review service responded with an error (HTTP " + response.status + ").");
        }
        return response.text();
      })
      .then(function (reviewText) {
        if (!reviewText.trim()) {
          throw new Error("The review service returned no review content.");
        }
        renderReviewResult(url, reviewText);
      })
      .catch(function (error) {
        var message = error instanceof TypeError
          ? "The code-review service could not be contacted. Confirm n8n is running and try again."
          : error.message || "The review could not be completed. Please try again.";
        showRequestError(message);
      })
      .finally(function () {
        setFormBusy(false);
      });
  }

  function resetToIdle() {
    if (requestInProgress) {
      return;
    }

    lastSubmittedUrl = "";
    form.reset();
    clearValidationError();
    clearReviewResult();
    setFormBusy(false);
    setWorkspaceState("idle");
    announce("");
    input.focus();
  }

  form.addEventListener("submit", function (event) {
    event.preventDefault();

    if (requestInProgress) {
      return;
    }

    var result = validateGitHubFileUrl(input.value);
    if (!result.valid) {
      clearValidationError();
      showValidationError(result.message);
      return;
    }

    clearValidationError();
    beginReview(result.value);
  });

  input.addEventListener("input", function () {
    if (input.getAttribute("aria-invalid") === "true") {
      clearValidationError();
    }
  });

  reviewAgainButtons.forEach(function (button) {
    button.addEventListener("click", resetToIdle);
  });

  retryButton.addEventListener("click", function () {
    if (!requestInProgress && lastSubmittedUrl) {
      beginReview(lastSubmittedUrl);
    }
  });

  showEmailButton.addEventListener("click", function () {
    emailForm.hidden = false;
    emailFormStatus.textContent = "Enter an email address to send the review.";
    recipientEmailInput.focus();
  });

  recipientEmailInput.addEventListener("input", function () {
    recipientEmailInput.removeAttribute("aria-invalid");
    recipientEmailError.hidden = true;
    recipientEmailError.textContent = "";
    emailFormStatus.textContent = "";
    updateEmailButtonState();
  });

  emailForm.addEventListener("submit", function (event) {
    event.preventDefault();

    if (!isValidEmail(recipientEmailInput.value)) {
      showEmailValidationError("Enter a valid recipient email address.");
      recipientEmailInput.focus();
      updateEmailButtonState();
      return;
    }

    if (emailRequestInProgress || !lastReviewText || !lastSubmittedUrl) {
      return;
    }

    emailRequestInProgress = true;
    sendEmailButton.disabled = true;
    recipientEmailInput.disabled = true;
    emailFormStatus.textContent = "Sending review...";
    announce("Sending the review by email.");

    fetch(CONFIG.emailWebhookUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        email: recipientEmailInput.value.trim(),
        reviewText: lastReviewText,
        reviewedUrl: lastSubmittedUrl,
        fileName: getReviewedFileName(lastSubmittedUrl)
      })
    })
      .then(function (response) {
        if (!response.ok) {
          throw new Error("The email service responded with an error (HTTP " + response.status + ").");
        }
        return response.text();
      })
      .then(function () {
        emailFormStatus.textContent = "Review sent successfully by email.";
        announce("Review sent successfully by email.");
      })
      .catch(function (error) {
        var message = error instanceof TypeError
          ? "The email service could not be contacted. Confirm n8n is running and try again."
          : error.message || "The review could not be sent by email. Please try again.";
        emailFormStatus.textContent = message;
        announce(message);
      })
      .finally(function () {
        emailRequestInProgress = false;
        recipientEmailInput.disabled = false;
        updateEmailButtonState();
      });
  });

  copyReviewButton.addEventListener("click", function () {
    var reviewText = resultContentEl.innerText.trim();

    if (!reviewText) {
      return;
    }

    if (!navigator.clipboard || !navigator.clipboard.writeText) {
      announce("Review could not be copied. Select the review text manually.");
      return;
    }

    navigator.clipboard.writeText(reviewText).then(function () {
      copyReviewButton.textContent = "Copied";
      announce("Review copied to clipboard.");
      window.setTimeout(function () {
        copyReviewButton.textContent = "Copy Review";
      }, 1600);
    }).catch(function () {
      announce("Review could not be copied. Select the review text manually.");
    });
  });

  if (window.lucide) {
    window.lucide.createIcons();
  }
})();
