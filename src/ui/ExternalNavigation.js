.pragma library

function userInitiatedRequestedUrl(request)
{
  if (!request || !request.userInitiated || !request.requestedUrl)
    return "";

  return request.requestedUrl.toString();
}
