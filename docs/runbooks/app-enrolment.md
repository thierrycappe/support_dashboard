# Application enrollment and lifecycle

Administrators can manage an application from the Applications list or its detail page.

- **Resubmit enrollment** is available for pending, unsuspended applications. It invalidates previous unused invitations and displays a fresh 30-minute invitation once. Store it in the connector configuration before leaving; existing identity, owners, and notification policy are retained.
- **Suspend application** blocks new incoming escalations and service authentication. Existing tickets and previously queued deliveries remain. **Resume application** restores access without changing the enrollment state. A pending app still needs to enroll.
- **Delete application** requires explicit confirmation. It permanently revokes credentials and unused invitations and removes the application from administration. Ticket and audit history remain available; its slug stays reserved so old connectors cannot recreate it.
