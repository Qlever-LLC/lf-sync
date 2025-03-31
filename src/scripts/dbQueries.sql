
-- Create the docs table
-- //bookmarks/trellisfw/documents/<docType>/<trellisDocKey>/_id => trellisDocKey
-- //bookmarks/trellisfw/documents/<docType>/<trellisDocKey>/_meta/vdoc/pdfs/<trellisPdfKey>/_id => pdfId
CREATE TABLE docs (
    id INT AUTO_INCREMENT PRIMARY KEY,
    pdfId VARCHAR(255) NOT NULL,
    tradingPartnerId VARCHAR(255) NOT NULL,
    docType VARCHAR(255) NOT NULL,
    lfEntryId VARCHAR(255) NULL,
    trellisDocKey VARCHAR(255) NOT NULL,
    trellisPdfKey VARCHAR(255) NOT NULL,
    trellisDocId VARCHAR(255) NOT NULL,
    lfFilename VARCHAR(255) NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

-- Create trading partners table
CREATE TABLE tradingPartners (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  externalIds JSON,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

-- Find content inside of externalIds like
SELECT * FROM tradingPartners WHERE JSON_CONTAINS(externalIds, '"some id"');

CREATE TABLE lfDocs(
  id INT AUTO_INCREMENT PRIMARY KEY,
  lfEntryId VARCHAR(255) NULL,
  path VARCHAR(255),
  tradingPartnerId VARCHAR(255),
  lfTradingPartnerName VARCHAR(255)
);