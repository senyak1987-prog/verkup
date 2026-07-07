<?php

// Copy this file to public/api/local-config.php on the server only.
// Do not commit the real webhook URL or sync token.

return [
    'BITRIX_WEBHOOK_URL' => '',
    'BITRIX_DOMAIN' => 'verkup.bitrix24.ru',

    // Optional protection for manual /api/bitrix/sync calls.
    // Automatic stale /data/deals.json sync does not need this token.
    'BITRIX_SYNC_TOKEN' => '',
    'BITRIX_SYNC_INTERVAL_SECONDS' => 300,
    'BITRIX_AUTO_SYNC_ON_READ' => '0',

    'BITRIX_TZ_STAGE_ID' => 'DETAILS',
    'BITRIX_TZ_APPROVAL_STAGE_ID' => '13',
    'BITRIX_LAUNCH_STAGE_ID' => '4',
    'BITRIX_PRODUCTION_STAGE_ID' => '10',
    'BITRIX_DEFECT_STAGE_ID' => '9',

    'BITRIX_FIELD_CLASSIFICATION' => 'UF_CRM_6512B7A78D965',
    'BITRIX_FIELD_INSTALL_AMOUNT' => 'UF_CRM_1547662428256',
    'BITRIX_FIELD_INSTALL_ADDRESS' => '',
    'BITRIX_FIELD_INSTALL_CLIENT_NAME' => '',
    'BITRIX_FIELD_INSTALL_CLIENT_PHONE' => '',
    'BITRIX_FIELD_INSTALL_COMMENT' => '',
    'BITRIX_FIELD_INSTALL_FILES' => '',
    'BITRIX_FIELD_TECH_SPEC_FILES' => '',
    'BITRIX_FIELD_START_DATE' => '',
    'BITRIX_FIELD_EXPECTED_FINISH_DATE' => '',

    // Address suggestions. Keep real keys only in server local-config.php.
    // ADDRESS_PROVIDER: auto | dadata | yandex
    'ADDRESS_PROVIDER' => 'auto',
    'DADATA_API_KEY' => '',
    'YANDEX_GEOCODER_API_KEY' => '',
];
